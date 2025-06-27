document.addEventListener("DOMContentLoaded", () => {
  const app_id = "82467";
  const redirect_uri = "https://saigex.github.io/Supersaige";

  // UI Elements
  const connectBtn = document.getElementById("connectBtn");
  const statusEl = document.getElementById("status");
  const balanceEl = document.getElementById("balance");

  const connectSection = document.getElementById("connectSection");
  const dashboardSection = document.getElementById("dashboard");

  const accountSelector = document.getElementById("accountSelector");
  const botStatusEl = document.getElementById("botStatus");
  const botBalanceEl = document.getElementById("botBalance");
  const strategySelect = document.getElementById("strategySelect");
  const startBtn = document.getElementById("startBot");
  const stopBtn = document.getElementById("stopBot");
  const tradeHistoryBody = document.getElementById("tradeHistoryBody");

  let ws;
  let token;
  let isBotRunning = false;
  let selectedSymbol = "R_100";
  let chart, lineSeries;
  let trades = [];
  let accounts = [];

  // Handle Connect Button
  connectBtn.onclick = () => {
    const loginUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&redirect_uri=${redirect_uri}`;
    window.location.href = loginUrl;
  };

  // Extract tokens and accounts from URL
  const urlParams = new URLSearchParams(window.location.search);
  for (let i = 1; i <= 20; i++) {
    const acct = urlParams.get(`acct${i}`);
    const tkn = urlParams.get(`token${i}`);
    const currency = urlParams.get(`cur${i}`) || "";
    if (acct && tkn) {
      accounts.push({ loginid: acct, token: tkn, currency });
    }
  }

  if (accounts.length === 0) {
    // No logged-in accounts
    connectSection.style.display = "flex";
    dashboardSection.style.display = "none";
    statusEl.textContent = "No accounts found. Please connect again.";
  } else {
    // Populate dropdown
    accountSelector.innerHTML = "";
    accounts.forEach(acc => {
      const option = document.createElement("option");
      option.value = acc.token;
      option.textContent = `${acc.loginid} (${acc.currency})`;
      accountSelector.appendChild(option);
    });

    // Always connect to first account by default
    connectToDeriv(accounts[0].token);
  }

  // Switch accounts on dropdown change
  accountSelector.addEventListener("change", (e) => {
    if (ws) ws.close();
    connectToDeriv(e.target.value);
  });

  // Core connection logic
function connectToDeriv(selectedToken) {
  token = selectedToken;
  isBotRunning = false;

  connectSection.style.display = "none";
  dashboardSection.style.display = "flex";

  botStatusEl.textContent = "Connecting to Deriv...";
  statusEl.textContent = "Connecting to Deriv...";
  startBtn.disabled = true;
  stopBtn.disabled = true;

  ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ authorize: token }));
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    console.log("WebSocket:", data);

    if (data.msg_type === "authorize") {
      statusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
      botStatusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
      getBalance();

      // We want to delay chart init so container is visible
      setTimeout(() => initChart(), 100);
    }

    if (data.msg_type === "balance") {
      let balance = parseFloat(data.balance.balance);
      balanceEl.textContent = `Balance: $${balance.toFixed(2)}`;
      botBalanceEl.textContent = `Balance: $${balance.toFixed(2)}`;

      if (balance <= 1) {
        startBtn.disabled = true;
        botStatusEl.textContent = "Cannot trade: Balance is under 1$.";
      } else {
        startBtn.disabled = false;
      }
    }

    if (data.msg_type === "tick" && isBotRunning) {
      handleTick(data.tick);
    }

    if (data.msg_type === "buy") {
      handleBuy(data.buy);
    }

    if (data.msg_type === "proposal_open_contract") {
      if (data.proposal_open_contract.is_sold) {
        handleContractResult(data.proposal_open_contract);
      }
    }
  };

  ws.onerror = () => {
    statusEl.textContent = "WebSocket error.";
    botStatusEl.textContent = "WebSocket error.";
    startBtn.disabled = true;
    stopBtn.disabled = true;
  };

  ws.onclose = () => {
    statusEl.textContent = "Disconnected.";
    botStatusEl.textContent = "Disconnected.";
    startBtn.disabled = true;
    stopBtn.disabled = true;
  };
}


  // WebSocket helpers
  function getBalance() {
    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
  }

  function subscribeTicks(symbol) {
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  }

  function forgetTicks() {
    ws.send(JSON.stringify({ forget_all: ["ticks"] }));
  }

  function makeDigitTrade(contractType, symbol) {
    ws.send(JSON.stringify({
      buy: 1,
      price: 1,
      parameters: {
        amount: 1,
        basis: "stake",
        contract_type: contractType,
        currency: "USD",
        duration: 1,
        duration_unit: "t",
        symbol: symbol
      }
    }));
  }

  // Chart
function initChart() {
  requestAnimationFrame(() => {
    const chartContainer = document.getElementById("chart");
    if (!chartContainer) return;

    // Clear existing chart
    if (chart) {
      chart.remove();
    }

    // Create new chart
    chart = LightweightCharts.createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
      layout: {
        backgroundColor: '#1e293b',
        textColor: 'rgba(255, 255, 255, 0.8)',
      },
      grid: {
        vertLines: { color: '#334155' },
        horzLines: { color: '#334155' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    });

    lineSeries = chart.addLineSeries({
      color: '#4ade80',
      lineWidth: 2,
    });

    lineSeries.setData([]);

    // Force a resize so it renders
    setTimeout(() => {
      chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
    }, 100);
  });
}


  // Bot logic
  function handleTick(tick) {
    const price = parseFloat(tick.quote);
    const lastDigit = parseInt(price.toString().slice(-1));
    botStatusEl.textContent = `Last digit: ${lastDigit}`;

    const strategy = strategySelect.value;
    if ((strategy === "even" && lastDigit % 2 === 0) || (strategy === "odd" && lastDigit % 2 !== 0)) {
      botStatusEl.textContent = `Last digit: ${lastDigit} → Buying DIGIT${strategy.toUpperCase()}`;
      makeDigitTrade(`DIGIT${strategy.toUpperCase()}`, selectedSymbol);
    }

    // Update chart
    const now = Math.floor(Date.now() / 1000);
    lineSeries.update({ time: now, value: price });
  }

  function handleBuy(buy) {
    botStatusEl.textContent = `Trade Placed: ${buy.contract_id}`;
    addTradeToHistory({
      contract_id: buy.contract_id,
      type: buy.contract_type,
      amount: buy.amount,
      profit: null,
      time: new Date().toLocaleTimeString()
    });
  }

  function handleContractResult(contract) {
    const profit = parseFloat(contract.profit).toFixed(2);
    botStatusEl.textContent = `Trade ended. Profit: $${profit}`;
    updateTradeProfit(contract.contract_id, profit);
  }

  // Trade History
  function addTradeToHistory(trade) {
    trades.unshift(trade);
    if (trades.length > 50) trades.pop();
    renderTradeHistory();
  }

  function updateTradeProfit(contract_id, profit) {
    const trade = trades.find(t => t.contract_id === contract_id);
    if (trade) {
      trade.profit = profit;
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
        <td>${trade.profit !== null ? trade.profit : "-"}</td>
        <td>${trade.time}</td>
      `;
      tradeHistoryBody.appendChild(tr);
    });
  }

  // Button handlers
  startBtn.onclick = () => {
    if (!isBotRunning) {
      isBotRunning = true;
      botStatusEl.textContent = "Bot started.";
      startBtn.disabled = true;
      stopBtn.disabled = false;
      subscribeTicks(selectedSymbol);
    }
  };

  stopBtn.onclick = () => {
    if (isBotRunning) {
      isBotRunning = false;
      botStatusEl.textContent = "Bot stopped.";
      startBtn.disabled = false;
      stopBtn.disabled = true;
      forgetTicks();
    }
  };
});
