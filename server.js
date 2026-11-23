const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { fileTypeFromBuffer } = require("file-type");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("Définis SESSION_SECRET avec une longue valeur aléatoire (au moins 32 caractères).");
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const db = new Database(path.join(dataDir, "lolochat.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    used_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.socket.io"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "20kb" }));

const sessionMiddleware = session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: "lolochat.sid",
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});
app.use(sessionMiddleware);

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  if (socket.request.session?.userId) return next();
  next(new Error("Non connecté"));
});

app.use("/uploads", express.static(uploadsDir, {
  dotfiles: "deny",
  index: false,
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=86400");
  }
}));
app.use(express.static(path.join(__dirname, "public")));

const authRequired = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: "Connecte-toi d'abord." });
  next();
};
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });

app.get("/api/me", (req, res) => {
  res.json(req.session.userId
    ? { user: { id: req.session.userId, username: req.session.username } }
    : { user: null });
});

app.post("/api/register", authLimiter, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const invite = String(req.body.invite || "").trim().toUpperCase();

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: "Le pseudo doit contenir 3 à 20 caractères (lettres, chiffres ou _)." });
  }
  if (password.length < 10 || password.length > 72) {
    return res.status(400).json({ error: "Le mot de passe doit contenir entre 10 et 72 caractères." });
  }
  if (!invite) return res.status(400).json({ error: "Entre ton code d'invitation." });

  const invitation = db.prepare("SELECT code, used_by FROM invites WHERE code = ?").get(invite);
  if (!invitation || invitation.used_by !== null) {
    return res.status(400).json({ error: "Code d'invitation invalide ou déjà utilisé." });
  }
  if (db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username)) {
    return res.status(409).json({ error: "Ce pseudo est déjà utilisé." });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const createUser = db.transaction(() => {
      const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
      const updated = db.prepare("UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL").run(result.lastInsertRowid, invite);
      if (updated.changes !== 1) throw new Error("INVITE_USED");
      return Number(result.lastInsertRowid);
    });
    const userId = createUser();
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Impossible de créer la session." });
      req.session.userId = userId;
      req.session.username = username;
      req.session.save(saveErr => {
        if (saveErr) return res.status(500).json({ error: "Impossible d'enregistrer la session." });
        res.json({ user: { id: userId, username } });
      });
    });
  } catch (err) {
    if (err.message === "INVITE_USED") return res.status(400).json({ error: "Ce code a déjà été utilisé." });
    if (String(err.code).startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "Ce pseudo est déjà utilisé." });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création du compte." });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE").get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Pseudo ou mot de passe incorrect." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Impossible de créer la session." });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: "Erreur de session." });
      res.json({ user: { id: user.id, username: user.username } });
    });
  });
});

app.post("/api/logout", authRequired, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("lolochat.sid");
    res.json({ ok: true });
  });
});

app.get("/api/messages", authRequired, (req, res) => {
  const messages = db.prepare(`
    SELECT id, username, text, image_url AS imageUrl, created_at AS createdAt
    FROM messages ORDER BY id DESC LIMIT 100
  `).all().reverse();
  res.json({ messages });
});

function saveMessage(user, text, imageUrl) {
  const result = db.prepare(
    "INSERT INTO messages (user_id, username, text, image_url) VALUES (?, ?, ?, ?)"
  ).run(user.id, user.username, text, imageUrl);
  const message = db.prepare(`
    SELECT id, username, text, image_url AS imageUrl, created_at AS createdAt
    FROM messages WHERE id = ?
  `).get(result.lastInsertRowid);
  io.emit("new-message", message);
  return message;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

app.post("/api/upload", authRequired, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choisis une image PNG ou GIF." });
  const type = await fileTypeFromBuffer(req.file.buffer);
  if (!type || !["image/png", "image/gif"].includes(type.mime)) {
    return res.status(400).json({ error: "Seuls les vrais fichiers PNG et GIF sont acceptés." });
  }
  const filename = crypto.randomUUID() + (type.mime === "image/png" ? ".png" : ".gif");
  fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer, { flag: "wx" });
  const message = saveMessage(
    { id: req.session.userId, username: req.session.username },
    "",
    "/uploads/" + filename
  );
  res.json({ message });
});

io.on("connection", socket => {
  const user = {
    id: socket.request.session.userId,
    username: socket.request.session.username
  };
  socket.on("send-message", payload => {
    if (!payload || typeof payload.text !== "string") return;
    const text = payload.text.trim();
    if (!text || text.length > 2000) return;
    saveMessage(user, text, null);
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: "Image trop volumineuse (maximum 5 Mo)." });
  console.error(err);
  res.status(500).json({ error: "Une erreur est survenue." });
});

server.listen(PORT, () => {
  console.log(`LOLOCHAT est lancé : http://localhost:${PORT}`);
});
