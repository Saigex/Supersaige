const app_id = "82467";
const redirect_uri = "https://saigex.github.io/Supersaige";

const connectBtn = document.getElementById("connectBtn");
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get("token");

let ws;

connectBtn.onclick = () => {
  const loginUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&redirect_uri=${redirect_uri}`;
  window.location.href = loginUrl;
};

if (token) {
  connectBtn.style.display = "none";
  document.getElementById("status").textContent = "Connecting to Deriv...";

  ws = new WebSocket("wss://ws.derivws.com/websockets/v3");

  ws.onopen = () => {
    ws.send(JSON.stringify({ authorize: token }));
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    console.log(data);

    if (data.msg_type === "authorize") {
      document.getElementById("status").textContent = `Logged in as: ${data.authorize.loginid}`;
      getBalance();
    }

    if (data.msg_type === "balance") {
      document.getElementById("balance").textContent = `Balance: $${data.balance.balance}`;
    }
  };

  function getBalance() {
    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
  }

  // 🔒 Clean URL
  if (window.history.replaceState) {
    window.history.replaceState({}, document.title, redirect_uri);
  }
}
