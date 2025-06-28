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
  let lastKnownBalance = 0;

  connectBtn.onclick = () => {
    const loginUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&redirect_uri=${redirect_uri}`;
    window.location.href = loginUrl;
  };

  // Extract access tokens from URL
  const urlParams = new URLSearchParams(window.location.search);
  const accounts = [];

  for (let i = 1; i <= 20; i++) {
    const acct = urlParams.get(`acct${i}`);
    const tok = urlParams.get(`token${i}`);
    const currency = urlParams.get(`cur${i}`) || "";
    if (acct && tok) {
      accounts.push({ loginid: acct, token: tok, currency });
      console.log(`Account ${i}:`, acct, tok, currency);
    }
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

    // Close previous connection if open
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

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

        // Clear previous chart container content
        const chartContainer = document.getElementById("chart");
        chartContainer.innerHTML = "";

        initChart();

        // Load historical data AFTER chart init and WebSocket open
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

        balanceEl.textContent = `Balance: $${balance.toFixed(2)}`;
        botBalanceEl.textContent = `Balance: $${balance.toFixed(2)}`;

        if (balance <= 0) {
          startBtn.disabled = true;
          botStatusEl.textContent = "Cannot trade: Balance is zero.";
        } else {
          startBtn.disabled = false;
        }
      }

      if (data.msg_type === "tick" && data.tick) {
        const tick = data.tick;
        const price = parseFloat(tick.quote);
        const lastDigit = parseInt(price.toString().slice(-1));

        botStatusEl.textContent = `Last digit: ${lastDigit}`;

        if (lineSeries) {
          lineSeries.update({ time: Math.floor(tick.epoch), value: price });
        }

        if (!isBotRunning) {
          // Prevent trading when bot is not running
          return;
        }

        const strategy = strategySelect.value;
        if (
          (strategy === "even" && lastDigit % 2 === 0) ||
          (strategy === "odd" && lastDigit % 2 !== 0)
        ) {
          botStatusEl.textContent = `Last digit: ${lastDigit} → Buying DIGIT${strategy.toUpperCase()}`;
          makeDigitTrade(`DIGIT${strategy.toUpperCase()}`, selectedSymbol);
        }
      }

      if (data.msg_type === "buy" && data.buy) {
        handleBuy(data.buy);
      }

      if (data.msg_type === "proposal_open_contract") {
        if (data.proposal_open_contract.is_sold) {
          const profit = data.proposal_open_contract.profit;
          botStatusEl.textContent = `Trade ended. Profit: $${profit.toFixed(2)}`;
          updateTradeProfit(data.proposal_open_contract.contract_id, profit);
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

    function initChart() {
      const chartContainer = document.getElementById("chart");

      if (!window.LightweightCharts) {
        console.error("LightweightCharts library is not loaded!");
        return;
      }

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
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
        },
        priceScale: {
          borderColor: "#334155",
        },
      });

      lineSeries = chart.addLineSeries({
        color: "#4ade80",
        lineWidth: 2,
      });

      // Initially empty, replaced by historical data on authorize
      lineSeries.setData([]);

      window.addEventListener("resize", () => {
        if (chart) {
          chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
        }
      });

      setTimeout(() => {
        chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
      }, 100);

      subscribeTicks(selectedSymbol);
    }

    // NEW function to load historical candles data from Deriv API
    function loadHistoricalData(symbol) {
      return new Promise((resolve, reject) => {
        const req_id = 1;
        // Send candles request
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
            if (data.history) {
              ws.removeEventListener("message", onMessage);
              // Map candles to {time, value}
              const candleData = data.history.candles.map(candle => ({
                time: candle.epoch,
                value: candle.close
              }));
              resolve(candleData);
            } else if (data.error) {
              ws.removeEventListener("message", onMessage);
              reject(data.error.message);
            }
          }
        }

        ws.addEventListener("message", onMessage);
      });
    }

    function handleBuy(buyData) {
      console.log("Buy Data:", buyData); // Debug

      botStatusEl.textContent = `Trade Placed: ${buyData.contract_id}`;

      // Simplify type to "Rise" or "Fall" based on contract_type or longcode
      let tradeType = "Unknown";
      if (buyData.contract_type) {
        if (buyData.contract_type.toLowerCase().includes("rise") || buyData.contract_type.toLowerCase().includes("call")) {
          tradeType = "Rise";
        } else if (buyData.contract_type.toLowerCase().includes("fall") || buyData.contract_type.toLowerCase().includes("put")) {
          tradeType = "Fall";
        } else if (buyData.contract_type.toLowerCase().includes("digit")) {
          tradeType = buyData.contract_type;
        } else {
          tradeType = buyData.contract_type;
        }
      } else if (buyData.longcode) {
        if (/rise/i.test(buyData.longcode) || /call/i.test(buyData.longcode)) {
          tradeType = "Rise";
        } else if (/fall/i.test(buyData.longcode) || /put/i.test(buyData.longcode)) {
          tradeType = "Fall";
        } else {
          tradeType = buyData.longcode.slice(0, 15) + "...";
        }
      }

      const amount = buyData.buy_price || buyData.amount || "-";

      addTradeToHistory({
        contract_id: buyData.contract_id,
        type: tradeType,
        amount: amount,
        profit: null,
        time: new Date().toLocaleTimeString(),
      });
    }
  }

  // === Global functions ===

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
    } else {
      console.warn("Trade not found for contract_id:", contract_id);
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

  // 🟩 Start/Stop bot handlers
  startBtn.onclick = () => {
    if (lastKnownBalance <= 0) {
      botStatusEl.textContent = "Cannot start: Balance is zero.";
      return;
    }
    if (!isBotRunning) {
      isBotRunning = true;
      botStatusEl.textContent = "Bot started.";
      startBtn.disabled = true;
      stopBtn.disabled = false;

      // Subscribe to ticks for the selected symbol
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ticks: selectedSymbol, subscribe: 1 }));
      }
    }
  };

  stopBtn.onclick = () => {
    if (isBotRunning) {
      isBotRunning = false;
      botStatusEl.textContent = "Bot stopped.";
      startBtn.disabled = false;
      stopBtn.disabled = true;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ forget_all: ["ticks"] }));
      }
    }
  };

  // ✅ Switching accounts correctly
  accountSelector.addEventListener("change", (e) => {
    if (ws) {
      ws.close();
    }

    // Reset state
    isBotRunning = false;
    lastKnownBalance = 0;
    trades = [];
    renderTradeHistory();

    // Reset UI
    balanceEl.textContent = "Balance: --";
    botBalanceEl.textContent = "Balance: --";
    botStatusEl.textContent = "Switching accounts...";
    statusEl.textContent = "Switching accounts...";
    startBtn.disabled = true;
    stopBtn.disabled = true;

    const newToken = e.target.value;
    connectToDeriv(newToken);
  });
});
