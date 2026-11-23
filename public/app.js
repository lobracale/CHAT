const $ = (id) => document.getElementById(id);
const authView = $("authView"), chatView = $("chatView");
let mode = "login", currentUser = null, socket = null;

function setMode(next) {
  mode = next;
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
  $("inviteField").classList.toggle("hidden", mode !== "register");
  $("submitAuth").textContent = mode === "login" ? "Se connecter" : "Créer mon compte";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authError").textContent = "";
}
$("loginTab").addEventListener("click", () => setMode("login"));
$("registerTab").addEventListener("click", () => setMode("register"));

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) },
    credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Une erreur est survenue.");
  return data;
}

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authError").textContent = "";
  const body = {
    username: $("username").value.trim(),
    password: $("password").value,
    invite: $("invite").value.trim()
  };
  try {
    const result = await api(mode === "login" ? "/api/login" : "/api/register", {
      method: "POST", body: JSON.stringify(body)
    });
    enterChat(result.user);
  } catch (error) { $("authError").textContent = error.message; }
});

function addMessage(message) {
  const list = $("messages");
  if (list.querySelector(`[data-id="${message.id}"]`)) return;
  const item = document.createElement("article");
  item.className = "message";
  item.dataset.id = message.id;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = (message.username || "?").slice(0, 1).toUpperCase();
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("strong");
  name.textContent = message.username;
  const time = document.createElement("time");
  const date = new Date((message.createdAt || "").replace(" ", "T") + (String(message.createdAt || "").endsWith("Z") ? "" : "Z"));
  time.textContent = Number.isNaN(date.getTime()) ? "" : date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  meta.append(name, time);
  body.append(meta);
  if (message.text) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text;
    body.append(text);
  }
  if (message.imageUrl) {
    const img = document.createElement("img");
    img.className = "message-image";
    img.src = message.imageUrl;
    img.alt = "Image envoyée dans la discussion";
    img.loading = "lazy";
    body.append(img);
  }
  item.append(avatar, body);
  list.append(item);
  list.scrollTop = list.scrollHeight;
}

async function enterChat(user) {
  currentUser = user;
  $("myName").textContent = user.username;
  $("myAvatar").textContent = user.username.slice(0, 1).toUpperCase();
  authView.classList.add("hidden");
  chatView.classList.remove("hidden");
  try {
    const data = await api("/api/messages");
    $("messages").replaceChildren();
    data.messages.forEach(addMessage);
    socket = io();
    socket.on("new-message", addMessage);
    socket.on("connect_error", () => console.warn("Connexion au chat interrompue."));
  } catch (error) {
    alert(error.message);
    authView.classList.remove("hidden");
    chatView.classList.add("hidden");
  }
}

$("messageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("messageInput");
  const text = input.value.trim();
  if (!text || !socket?.connected) return;
  socket.emit("send-message", { text });
  input.value = "";
  input.focus();
});

$("imageInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("image", file);
  try {
    await api("/api/upload", { method: "POST", body: form });
  } catch (error) { alert(error.message); }
  event.target.value = "";
});

$("logoutBtn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", body: "{}" }); } catch {}
  if (socket) socket.disconnect();
  location.reload();
});

(async function init() {
  try {
    const data = await api("/api/me");
    if (data.user) enterChat(data.user);
  } catch {}
})();
