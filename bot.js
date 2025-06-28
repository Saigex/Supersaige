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

  let ws;
  let token;
  let isBotRunning = false;
  let selectedSymbol = "R_100";
  let chart, lineSeries;
  let trades = [];
  let lastKnownBalance = 0;

  // Guardian strategy variables
  let stakePercent = 0.01;           // Start at 1%
  let consecutiveWins = 0;
  let startingBalance = 0;
  let totalProfitUSD = 0;

  connectBtn.onclick = () => {
    const loginUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&redirect_uri=${redirect_uri}`;
    window.location.href = loginUrl;
  };

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

      if (data.msg_type === "authorize") {
        statusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
        botStatusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
        getBalance();

        // Reset Guardian strategy vars on new login
        startingBalance = 0;
        stakePercent = 0.01;
        consecutiveWins = 0;
        totalProfitUSD = 0;

        const chartContainer = document.getElementById("chart");
        chartContainer.innerHTML = "";
        initChart();

        try {
          const historicalData = await loadHistoricalData(selectedSymbol);
          lineSeries.setData(historicalData);
        } catch (err) {
          console.error("Error loading historical data:", err);
        }
      }

      if (data.msg_type === "balance") {
        let balance = parseFloat(data.balance.balance);
        lastKnownBalance = balance;

        if (startingBalance === 0) startingBalance = balance;

        balanceEl.textContent = `Balance: $${balance.toFixed(2)}`;
        botBalanceEl.textContent = `Balance: $${balance.toFixed(2)}`;

        startBtn.disabled = balance <= 0;
        botStatusEl.textContent = balance <= 0 ? "Cannot trade: Balance is zero." : "";
      }

      if (data.msg_type === "tick" && data.tick) {
  const tick = data.tick;
  const price = parseFloat(tick.quote);
  const lastDigit = parseInt(price.toString().slice(-1));

  console.log("Tick received - lastDigit:", lastDigit);

  botStatusEl.textContent = `Last digit: ${lastDigit}`;

  if (lineSeries) lineSeries.update({ time: Math.floor(tick.epoch), value: price });

  if (!isBotRunning) return;

  if (lastDigit % 2 === 0) {
    const stakeAmount = +(lastKnownBalance * stakePercent).toFixed(2);
    console.log("Attempting trade with stake:", stakeAmount);

    if (stakeAmount < 1) {
      console.warn("Stake too low to place trade, must be at least 1 USD");
      return;
    }

    botStatusEl.textContent = `Last digit: ${lastDigit} → Buying DIGITEVEN with stake $${stakeAmount}`;

    makeDigitTradeWithAmount("DIGITEVEN", selectedSymbol, stakeAmount);
  }
}

      if (data.msg_type === "buy" && data.buy) {
        console.log("Buy response:", data.buy);
        handleBuy(data.buy);
      }

      if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract.is_sold) {
        const profit = data.proposal_open_contract.profit;
        const contract_id = data.proposal_open_contract.contract_id;

        botStatusEl.textContent = `Trade ended. Profit: $${profit.toFixed(2)}`;

        updateTradeProfit(contract_id, profit);

        // Update total profit in USD
        totalProfitUSD += profit;

        // Adjust stakePercent according to win/loss
        if (profit > 0) {
          consecutiveWins++;
          if (consecutiveWins > 3) consecutiveWins = 3;  // max 3 consecutive doubles
          stakePercent = Math.min(0.01 * Math.pow(2, consecutiveWins), 0.2); // max 20%
        } else {
          consecutiveWins = 0;
          stakePercent = 0.01; // reset to 1%
        }

        // Calculate profit/loss in % relative to starting balance
        const profitPercent = (totalProfitUSD / startingBalance) * 100;

        // Stop conditions
        if (profitPercent >= 15) {
          botStatusEl.textContent = `Profit target reached (${profitPercent.toFixed(2)}%). Stopping bot.`;
          isBotRunning = false;
          startBtn.disabled = false;
          stopBtn.disabled = true;
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ forget_all: ["ticks"] }));
        } else if (profitPercent <= -10) {
          botStatusEl.textContent = `Loss limit reached (${profitPercent.toFixed(2)}%). Stopping bot.`;
          isBotRunning = false;
          startBtn.disabled = false;
          stopBtn.disabled = true;
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ forget_all: ["ticks"] }));
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

    function makeDigitTradeWithAmount(contractType, symbol, amount) {
      ws.send(JSON.stringify({
        buy: 1,
        price: 1,
        parameters: {
          amount: amount,
          basis: "stake",
          contract_type: contractType,
          currency: "USD",
          duration: 1,
          duration_unit: "t",
          symbol: symbol
        }
      }));
    }

    function initChart() {
      const chartContainer = document.getElementById("chart");
      chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
        layout: {
          backgroundColor: "#0f172a",
          textColor: "#94a3b8",
        },
        grid: {
          vertLines: { color: "#334155" },
          horzLines: { color: "#334155" },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        priceScale: { borderColor: "#334155" },
      });

      lineSeries = chart.addLineSeries({ color: "#4ade80", lineWidth: 2 });
      lineSeries.setData([]);

      window.addEventListener("resize", () => {
        if (chart) chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
      });
    }

    function loadHistoricalData(symbol) {
      return new Promise((resolve, reject) => {
        const req_id = 9999;
        ws.send(JSON.stringify({
          ticks_history: symbol,
          end: "latest",
          count: 100,
          granularity: 60,
          style: "candles",
          req_id: req_id
        }));

        function onMessage(event) {
          const data = JSON.parse(event.data);
          if (data.req_id === req_id) {
            ws.removeEventListener("message", onMessage);
            if (data.history && data.history.candles) {
              const candles = data.history.candles.map(c => ({ time: c.epoch, value: c.close }));
              resolve(candles);
            } else {
              reject(data.error?.message || "No candle data returned");
            }
          }
        }

        ws.addEventListener("message", onMessage);
      });
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
    if (lastKnownBalance <= 0) {
      botStatusEl.textContent = "Cannot start: Balance is zero.";
      return;
    }
    isBotRunning = true;
    botStatusEl.textContent = "Bot started.";
    startBtn.disabled = true;
    stopBtn.disabled = false;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ticks: selectedSymbol, subscribe: 1 }));
  };

  stopBtn.onclick = () => {
    isBotRunning = false;
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
