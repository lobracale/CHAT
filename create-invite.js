// Crée un code d'invitation à usage unique.
// Utilisation : node create-invite.js
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "lolochat.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    used_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
const code = crypto.randomBytes(5).toString("hex").toUpperCase();
db.prepare("INSERT INTO invites (code) VALUES (?)").run(code);
console.log("\\nCode d'invitation LOLOCHAT (à transmettre en privé) :");
console.log(code + "\\n");
db.close();
