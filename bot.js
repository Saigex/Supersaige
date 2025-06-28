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
  let selectedSymbol = "R_75"; // Volatility 75 (1s) symbol
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
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.msg_type === "authorize") {
        statusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
        botStatusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
        getBalance();
        initChart();
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

      if (data.msg_type === "tick" && isBotRunning) {
        const tick = data.tick;
        const price = parseFloat(tick.quote);
        const lastDigit = parseInt(price.toString().slice(-1));
        botStatusEl.textContent = `Last digit: ${lastDigit}`;

        if (lineSeries) {
          lineSeries.update({ time: Math.floor(tick.epoch), value: price });
        }

        const strategy = strategySelect.value;
        if ((strategy === "even" && lastDigit % 2 === 0) || (strategy === "odd" && lastDigit % 2 !== 0)) {
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
  }

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

let chart;  // Declare chart at the top
let lineSeries;  // Declare lineSeries globally
let ws;  // WebSocket connection

// Function to initialize the chart (only once)
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
      vertLines: { color: '#334155' },
      horzLines: { color: '#334155' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    priceScale: {
      borderColor: '#334155',
    },
  });

  lineSeries = chart.addLineSeries({
    color: '#4ade80',
    lineWidth: 2,
  });

  lineSeries.setData([]);  // Initialize with empty data

  // Resize chart on window size change
  window.addEventListener("resize", () => {
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
  });

  setTimeout(() => {
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
  }, 100);
}

// Function to subscribe to ticks for the selected symbol
function subscribeTicks(symbol) {
  if (ws) {
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  }
}

// Function to forget all tick subscriptions
function forgetTicks() {
  if (ws) {
    ws.send(JSON.stringify({ forget_all: ["ticks"] }));
  }
}

// Function to connect to Deriv using WebSocket
function connectToDeriv(token) {
  if (ws) {
    ws.close(); // Close the previous WebSocket connection if any
  }

  ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ authorize: token }));
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    // Handle responses (e.g., authorization, balance, ticks)
    if (data.msg_type === "authorize") {
      statusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
      botStatusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
      getBalance();
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

    if (data.msg_type === "tick" && isBotRunning) {
      const tick = data.tick;
      const price = parseFloat(tick.quote);
      const lastDigit = parseInt(price.toString().slice(-1));

      botStatusEl.textContent = `Last digit: ${lastDigit}`;

      if (lineSeries) {
        lineSeries.update({ time: Math.floor(tick.epoch), value: price });
      }

      const strategy = strategySelect.value;
      if ((strategy === "even" && lastDigit % 2 === 0) || (strategy === "odd" && lastDigit % 2 !== 0)) {
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
}

// Initial chart setup
initChart(); // Initialize the chart only once when the page loads

// Handle account selection change
accountSelector.onchange = () => {
  const selectedToken = accountSelector.value;
  connectToDeriv(selectedToken);  // Connect to the new account
  subscribeTicks(selectedSymbol); // Start subscribing to ticks
};

// Start/Stop Bot
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
