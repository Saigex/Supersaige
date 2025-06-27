const app_id = "82467";
const redirect_uri = "https://saigex.github.io/Supersaige";

const connectBtn = document.getElementById("connectBtn");
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get("token");

let ws;
let isBotRunning = false;
let currentSymbol = "R_100"; // You can change this to R_50, R_75, etc.
let tickSubscriptionId = null;

const startBtn = document.createElement("button");
startBtn.textContent = "Start Bot";
startBtn.style.marginTop = "20px";

const stopBtn = document.createElement("button");
stopBtn.textContent = "Stop Bot";
stopBtn.style.marginTop = "10px";
stopBtn.style.backgroundColor = "#ef4444";
stopBtn.style.color = "white";

document.querySelector(".container").appendChild(startBtn);
document.querySelector(".container").appendChild(stopBtn);

connectBtn.onclick = () => {
  const loginUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&redirect_uri=${redirect_uri}`;
  window.location.href = loginUrl;
};

if (token) {
  connectBtn.style.display = "none";
  document.getElementById("status").textContent = "Connecting to Deriv...";

  ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=" + app_id);

  ws.onopen = () => {
    ws.send(JSON.stringify({ authorize: token }));
  };

ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  console.log(data);

  if (data.msg_type === "authorize") {
    document.getElementById("status").textContent = `Logged in as: ${data.authorize.loginid}`;
    getBalance();

    // ✅ Show Start/Stop buttons AFTER login
    const startBtn = document.createElement("button");
    startBtn.textContent = "Start Bot";
    startBtn.style.marginTop = "20px";

    const stopBtn = document.createElement("button");
    stopBtn.textContent = "Stop Bot";
    stopBtn.style.marginTop = "10px";
    stopBtn.style.backgroundColor = "#ef4444";
    stopBtn.style.color = "white";

    document.querySelector(".container").appendChild(startBtn);
    document.querySelector(".container").appendChild(stopBtn);

    // 🔁 Bot Controls
    startBtn.onclick = () => {
      isBotRunning = true;
      document.getElementById("status").textContent = "Bot started...";
      subscribeTicks(currentSymbol);
    };

    stopBtn.onclick = () => {
      isBotRunning = false;
      document.getElementById("status").textContent = "Bot stopped.";
      forgetTicks();
    };
  }

  if (data.msg_type === "balance") {
    document.getElementById("balance").textContent = `Balance: $${data.balance.balance.toFixed(2)}`;
  }

  if (data.msg_type === "tick" && isBotRunning) {
    const tick = data.tick;
    const price = parseFloat(tick.quote);
    const lastDigit = parseInt(price.toString().slice(-1));

    document.getElementById("status").textContent = `Last digit: ${lastDigit}`;

    if (lastDigit % 2 === 0) {
      document.getElementById("status").textContent = `Last digit: ${lastDigit} → Buying DIGITEVEN`;
      makeDigitTrade("DIGITEVEN", currentSymbol);
    }
  }

  if (data.msg_type === "buy") {
    document.getElementById("status").textContent = `Trade Placed: ${data.buy.contract_id}`;
  }

  if (data.msg_type === "proposal_open_contract") {
    if (data.proposal_open_contract.is_sold) {
      const profit = data.proposal_open_contract.profit;
      document.getElementById("status").textContent = `Trade ended. Profit: $${profit.toFixed(2)}`;
    }
  }
};

  function getBalance() {
    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
  }

  function subscribeTicks(symbol) {
    ws.send(JSON.stringify({
      ticks: symbol,
      subscribe: 1
    }));
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

  startBtn.onclick = () => {
    isBotRunning = true;
    document.getElementById("status").textContent = "Bot started...";
    subscribeTicks(currentSymbol);
  };

  stopBtn.onclick = () => {
    isBotRunning = false;
    document.getElementById("status").textContent = "Bot stopped.";
    forgetTicks();
  };

  // Clean URL
  if (window.history.replaceState) {
    window.history.replaceState({}, document.title, redirect_uri);
  }
}
