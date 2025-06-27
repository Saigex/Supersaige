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

  connectBtn.onclick = () => {
    const loginUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&redirect_uri=${redirect_uri}`;
    window.location.href = loginUrl;
  };

  // Extract access token from URL hash (#access_token=...
const urlParams = new URLSearchParams(window.location.search);

// Parse all accounts and tokens into a list
const accounts = [];

for (let i = 1; i <= 20; i++) {
  const acct = urlParams.get(`acct${i}`);
  const token = urlParams.get(`token${i}`);
  const currency = urlParams.get(`cur${i}`) || "";
  if (acct && token) {
    accounts.push({ loginid: acct, token, currency });
  }
}

if (accounts.length === 0) {
  connectSection.style.display = "flex";
  dashboardSection.style.display = "none";
  statusEl.textContent = "No accounts found. Please connect again.";
} else {
  // Populate the dropdown
  accountSelector.innerHTML = "";
  accounts.forEach((acc, i) => {
    const option = document.createElement("option");
    option.value = acc.token;
    option.textContent = `${acc.loginid} (${acc.currency})`;
    accountSelector.appendChild(option);
  });

  // Show dashboard
  connectSection.style.display = "none";
  dashboardSection.style.display = "flex";

  // Connect to the first account by default
  connectToDeriv(accounts[0].token);
}


  if (token) {
    // Clean the URL after extracting token
    window.history.replaceState({}, document.title, redirect_uri);

    connectSection.style.display = "none";
    dashboardSection.style.display = "flex";

    statusEl.textContent = "Connecting to Deriv...";
    botStatusEl.textContent = "Connecting to Deriv...";

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      console.log("WebSocket message:", data); // Debug log

      if (data.msg_type === "authorize") {
        statusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
        botStatusEl.textContent = `Logged in as: ${data.authorize.loginid}`;
        getBalance();
        getAccountList();
        initChart();
        startBtn.disabled = false;
      }

      if (data.msg_type === "balance") {
        balanceEl.textContent = `Balance: $${parseFloat(data.balance.balance).toFixed(2)}`;
        botBalanceEl.textContent = `Balance: $${parseFloat(data.balance.balance).toFixed(2)}`;
      }

      if (data.msg_type === "tick" && isBotRunning) {
        const tick = data.tick;
        const price = parseFloat(tick.quote);
        const lastDigit = parseInt(price.toString().slice(-1));

        botStatusEl.textContent = `Last digit: ${lastDigit}`;

        const strategy = strategySelect.value;

        if ((strategy === "even" && lastDigit % 2 === 0) || (strategy === "odd" && lastDigit % 2 !== 0)) {
          botStatusEl.textContent = `Last digit: ${lastDigit} → Buying DIGIT${strategy.toUpperCase()}`;
          makeDigitTrade(`DIGIT${strategy.toUpperCase()}`, selectedSymbol);
        }
      }

      if (data.msg_type === "buy") {
        botStatusEl.textContent = `Trade Placed: ${data.buy.contract_id}`;
        addTradeToHistory({
          contract_id: data.buy.contract_id,
          type: data.buy.contract_type,
          amount: data.buy.amount,
          profit: null,
          time: new Date().toLocaleTimeString()
        });
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

    function getAccountList() {
      accountSelector.innerHTML = "";
      const option = document.createElement("option");
      option.value = "default";
      option.textContent = "Default Account";
      accountSelector.appendChild(option);
      accountSelector.hidden = false;
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
      if (chart) {
        chart.remove();
      }
      chart = LightweightCharts.createChart(document.getElementById("chart"), {
        width: document.getElementById("chart").clientWidth,
        height: document.getElementById("chart").clientHeight,
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
          <td>${trade.profit !== null ? trade.profit : "-"}</td>
          <td>${trade.time}</td>
        `;
        tradeHistoryBody.appendChild(tr);
      });
    }

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

    window.addEventListener("resize", () => {
      if (chart) {
        chart.applyOptions({ width: document.getElementById("chart").clientWidth });
      }
    });

  } else {
    connectSection.style.display = "flex";
    dashboardSection.style.display = "none";
  }
});
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
      startBtn.disabled = false;
    }

    if (data.msg_type === "balance") {
      balanceEl.textContent = `Balance: $${parseFloat(data.balance.balance).toFixed(2)}`;
      botBalanceEl.textContent = `Balance: $${parseFloat(data.balance.balance).toFixed(2)}`;
    }

    if (data.msg_type === "tick" && isBotRunning) {
      const tick = data.tick;
      const price = parseFloat(tick.quote);
      const lastDigit = parseInt(price.toString().slice(-1));
      botStatusEl.textContent = `Last digit: ${lastDigit}`;

      const strategy = strategySelect.value;
      if ((strategy === "even" && lastDigit % 2 === 0) || (strategy === "odd" && lastDigit % 2 !== 0)) {
        botStatusEl.textContent = `Last digit: ${lastDigit} → Buying DIGIT${strategy.toUpperCase()}`;
        makeDigitTrade(`DIGIT${strategy.toUpperCase()}`, selectedSymbol);
      }
    }

    if (data.msg_type === "buy") {
      botStatusEl.textContent = `Trade Placed: ${data.buy.contract_id}`;
      addTradeToHistory({
        contract_id: data.buy.contract_id,
        type: data.buy.contract_type,
        amount: data.buy.amount,
        profit: null,
        time: new Date().toLocaleTimeString()
      });
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

// Allow changing accounts
accountSelector.addEventListener("change", (e) => {
  if (ws) ws.close();
  const newToken = e.target.value;
  connectToDeriv(newToken);
});
