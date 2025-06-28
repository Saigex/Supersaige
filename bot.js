document.addEventListener("DOMContentLoaded", () => {
  const app_id = "82467";
  const redirect_uri = "https://saigex.github.io/Supersaige";

  const connectBtn = document.getElementById("connectBtn");
  const statusEl = document.getElementById("status");
  const balanceEl = document.getElementById("balance");

  const connectSection = document.getElementById("connectSection");
  const dashboardSection = document.getElementById("dashboard");

  const accountSelector = document.getElementById("accountSelector");
  const botStatusEl = document.getElementById("botStatus");
  const botBalanceEl = document.getElementById("botBalance");
  const startBtn = document.getElementById("startBot");
  const stopBtn = document.getElementById("stopBot");
  const tradeHistoryBody = document.getElementById("tradeHistoryBody");

  // New: User input for initial stake amount
  const stakeInput = document.getElementById("stakeInput"); 

  const digitCanvas = document.getElementById("digitChart");
  const digitChart = new Chart(digitCanvas, {
    type: 'bar',
    data: {
      labels: [...Array(10).keys()].map(String),
      datasets: [{
        label: 'Digit Frequency (%)',
        data: Array(10).fill(0),
        backgroundColor: '#4ade80'
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            color: '#94a3b8',
            callback: value => value + '%'
          }
        },
        x: {
          ticks: { color: '#94a3b8' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%`
          }
        }
      }
    }
  });

  const last100Digits = []; // To hold last 100 digits for histogram

  let ws;
  let token;
  let isBotRunning = false;
  let selectedSymbol = "R_100";
  let chart, lineSeries;
  let trades = [];
  let lastKnownBalance = 0;

  // Strategy variables:
  let initialStake = 1;   // User sets this, minimum 1$
  let currentStake = 1;
  let waitingForResult = false;
  let currentContractType = "DIGITUNDER9";

  connectBtn.onclick = () => {
    const loginUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&redirect_uri=${redirect_uri}`;
    window.location.href = loginUrl;
  };

  // Initialize stake input value & listener
  if(stakeInput){
    stakeInput.value = initialStake.toFixed(2);
    stakeInput.addEventListener("change", () => {
      let val = parseFloat(stakeInput.value);
      if (isNaN(val) || val < 1) val = 1;
      stakeInput.value = val.toFixed(2);
      initialStake = val;
      currentStake = val;
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  const accounts = [];

  for (let i = 1; i <= 20; i++) {
    const acct = urlParams.get(`acct${i}`);
    const tok = urlParams.get(`token${i}`);
    const currency = urlParams.get(`cur${i}`) || "";
    if (acct && tok) accounts.push({ loginid: acct, token: tok, currency });
  }

  if (accounts.length === 0) {
    connectSection.style.display = "flex";
    dashboardSection.style.display = "none";
    statusEl.textContent = "No accounts found. Please connect again.";
  } else {
    connectSection.style.display = "none";
    dashboardSection.style.display = "flex";

    accountSelector.innerHTML = "";
    accounts.forEach(acc => {
      const option = document.createElement("option");
      option.value = acc.token;
      option.textContent = `${acc.loginid} (${acc.currency})`;
      accountSelector.appendChild(option);
    });

    connectToDeriv(accounts[0].token);
  }

  function connectToDeriv(selectedToken) {
    token = selectedToken;
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);
      console.log("WS message received:", data);

      if (data.msg_type === "authorize") {
        statusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
        botStatusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
        getBalance();

        // Reset strategy state
        currentStake = initialStake;
        waitingForResult = false;
        currentContractType = "DIGITUNDER9";

        const chartContainer = document.getElementById("chart");
        chartContainer.innerHTML = "";
        initChart();

        try {
          const historicalData = await loadHistoricalData(selectedSymbol);
          lineSeries.setData(historicalData);
        } catch (err) {
          console.error("Error loading historical data:", err);
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ticks: selectedSymbol, subscribe: 1 }));
        }
      }

      if (data.msg_type === "balance") {
        let balance = parseFloat(data.balance.balance);
        lastKnownBalance = balance;

        balanceEl.textContent = `Balance: $${balance.toFixed(2)}`;
        botBalanceEl.textContent = `Balance: $${balance.toFixed(2)}`;

        startBtn.disabled = balance < 1;
        botStatusEl.textContent = balance < 1 ? "Cannot trade: Balance less than $1." : "";
      }

      if (data.msg_type === "tick" && data.tick) {
        const tick = data.tick;
        const price = parseFloat(tick.quote);
        const lastDigit = extractLastDigit(price);

        if(lastDigit === null) return;

        // Update last 100 digits array
        last100Digits.push(lastDigit);
        if (last100Digits.length > 100) last100Digits.shift();

        // Update digit frequency chart
        updateDigitChart();

        botStatusEl.textContent = `Last digit: ${lastDigit}`;
        if (lineSeries) lineSeries.update({ time: Math.floor(tick.epoch), value: price });

        // === Strategy execution ===
        if (!isBotRunning || waitingForResult) return;

        // Place trade based on currentContractType strategy
        placeTrade(currentContractType);
      }

      if (data.msg_type === "buy" && data.buy) {
        handleBuy(data.buy);
      }

      if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract.is_sold) {
        const profit = data.proposal_open_contract.profit;
        const contract_id = data.proposal_open_contract.contract_id;

        botStatusEl.textContent = `Trade ended. Profit: $${profit.toFixed(2)}`;
        updateTradeProfit(contract_id, profit);

        waitingForResult = false;

        if (profit > 0) {
          // Win: reset stake & contract type
          currentStake = initialStake;
          currentContractType = "DIGITUNDER9";
          botStatusEl.textContent = `Trade won! Stake reset to $${currentStake.toFixed(2)}.`;
        } else {
          // Loss: increase stake by 25%
          currentStake = +(currentStake * 1.25).toFixed(2);

          if (currentContractType === "DIGITUNDER9") {
            currentContractType = "DIGITUNDER5";
            botStatusEl.textContent = `Lost on DIGITUNDER9. Switching to DIGITUNDER5 and increasing stake to $${currentStake.toFixed(2)}.`;
          } else {
            botStatusEl.textContent = `Lost on DIGITUNDER5. Increasing stake to $${currentStake.toFixed(2)} and retrying DIGITUNDER5.`;
          }
        }
      }
    };

    ws.onerror = () => {
      statusEl.textContent = "WebSocket error.";
      botStatusEl.textContent = "WebSocket error.";
    };

    ws.onclose = () => {
      statusEl.textContent = "Disconnected.";
      botStatusEl.textContent = "Disconnected.";
      startBtn.disabled = true;
      stopBtn.disabled = true;
    };

    function getBalance() {
      ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    }

    function placeTrade(contractType) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const amount = +currentStake.toFixed(2);
      if (amount < 1) {
        botStatusEl.textContent = "Stake less than minimum $1. Stopping bot.";
        stopBtn.click();
        return;
      }

      // Duration 5 ticks (you can adjust)
      const duration = 5;

      const buyRequest = {
        buy: 1,
        subscribe: 1,
        price: amount,
        parameters: {
          amount,
          basis: "stake",
          contract_type: contractType,
          currency: "USD",
          duration,
          duration_unit: "t",
          symbol: selectedSymbol,
        },
        req_id: Date.now()
      };

      ws.send(JSON.stringify(buyRequest));
      botStatusEl.textContent = `Placing trade: ${contractType} for $${amount.toFixed(2)}`;
      waitingForResult = true;
    }

    function extractLastDigit(price) {
      // Convert to string and get last numeric digit ignoring decimal point
      const priceStr = price.toString();
      for (let i = priceStr.length - 1; i >= 0; i--) {
        if ("0123456789".includes(priceStr[i])) {
          return parseInt(priceStr[i]);
        }
      }
      return null;
    }

    function updateDigitChart() {
      const counts = Array(10).fill(0);
      last100Digits.forEach(d => counts[d]++);
      const total = last100Digits.length;
      const percentages = counts.map(c => (c / total) * 100);
      digitChart.data.datasets[0].data = percentages;
      digitChart.update();
    }

    function handleBuy(buyData) {
      const type = buyData.contract_type?.includes("DIGIT") ? buyData.contract_type :
        /rise|call/i.test(buyData.longcode) ? "Rise" :
        /fall|put/i.test(buyData.longcode) ? "Fall" : "Unknown";

      addTradeToHistory({
        contract_id: buyData.contract_id,
        type: type,
        amount: buyData.buy_price || "-",
        profit: null,
        time: new Date().toLocaleTimeString(),
      });
    }
  }

  function addTradeToHistory(trade) {
    trades.unshift(trade);
    if (trades.length > 50) trades.pop();
    renderTradeHistory();
  }

  function updateTradeProfit(contract_id, profit) {
    const trade = trades.find(t => t.contract_id === contract_id);
    if (trade) {
      trade.profit = profit.toFixed(2);
      renderTradeHistory();
    }
  }

  function renderTradeHistory() {
    tradeHistoryBody.innerHTML = "";
    trades.forEach(trade => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${trade.contract_id}</td>
        <td>${trade.type}</td>
        <td>${trade.amount}</td>
        <td>${trade.profit ?? "-"}</td>
        <td>${trade.time}</td>
      `;
      tradeHistoryBody.appendChild(tr);
    });
  }

  startBtn.onclick = () => {
    if (lastKnownBalance < 1) {
      botStatusEl.textContent = "Cannot start: Balance less than $1.";
      return;
    }

    if(stakeInput){
      let val = parseFloat(stakeInput.value);
      if (isNaN(val) || val < 1) {
        stakeInput.value = "1.00";
        initialStake = 1;
      } else {
        initialStake = val;
      }
      currentStake = initialStake;
    }

    isBotRunning = true;
    botStatusEl.textContent = "Bot started.";
    startBtn.disabled = true;
    stopBtn.disabled = false;

    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ticks: selectedSymbol, subscribe: 1 }));
  };

  stopBtn.onclick = () => {
    isBotRunning = false;
    waitingForResult = false;
    currentStake = initialStake;
    currentContractType = "DIGITUNDER9";
    botStatusEl.textContent = "Bot stopped.";
    startBtn.disabled = false;
    stopBtn.disabled = true;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ forget_all: ["ticks"] }));
  };

  accountSelector.addEventListener("change", (e) => {
    if (ws) ws.close();
    isBotRunning = false;
    lastKnownBalance = 0;
    trades = [];
    renderTradeHistory();
    balanceEl.textContent = botBalanceEl.textContent = "Balance: --";
    botStatusEl.textContent = statusEl.textContent = "Switching accounts...";
    startBtn.disabled = stopBtn.disabled = true;
    connectToDeriv(e.target.value);
  });
});
