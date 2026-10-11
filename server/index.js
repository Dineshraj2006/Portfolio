import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DIST = path.join(__dirname, "..", "dist");
const PORT = Number(process.env.PORT) || 3001;
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const app = express();
app.disable("x-powered-by");
// Set TRUST_PROXY=1 when running behind Render, Railway, Nginx etc. so rate limits see real visitor IPs.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);

/* ───────────── security headers ───────────── */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://ghchart.rshah.org https://leetcard.jacoblin.cool",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": CSP,
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});

app.use(express.json({ limit: "8mb" }));

/* ───────────── tiny in-memory rate limiter ───────────── */
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60_000).unref();
  return (req, res, next) => {
    const now = Date.now();
    let a = hits.get(req.ip);
    if (!a || a.reset < now) { a = { n: 0, reset: now + windowMs }; hits.set(req.ip, a); }
    if (++a.n > max) return res.status(429).json({ error: "Too many requests. Slow down." });
    next();
  };
}
app.use("/api", limiter(600, 60_000));
const writeLimit = limiter(120, 60_000);

/* ───────────── password + sessions ───────────── */
const AUTH_FILE = path.join(DATA_DIR, "admin.json");
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
const safeEqualHex = (a, b) => {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function saveAuth(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const tmp = AUTH_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ salt, hash: hashPw(password, salt) }));
  fs.renameSync(tmp, AUTH_FILE);
}
if (!fs.existsSync(AUTH_FILE)) saveAuth(process.env.ADMIN_PASSWORD || "admin123");

const sessions = new Map(); // token -> expiry
const SESSION_MS = 12 * 60 * 60 * 1000;
setInterval(() => { const now = Date.now(); for (const [t, e] of sessions) if (e < now) sessions.delete(t); }, 10 * 60_000).unref();

const fails = new Map(); // ip -> { n, reset }
const isLocked = (ip) => { const f = fails.get(ip); return !!f && f.reset > Date.now() && f.n >= 10; };
function recordFail(ip) {
  const now = Date.now();
  let f = fails.get(ip);
  if (!f || f.reset < now) { f = { n: 0, reset: now + 15 * 60_000 }; fails.set(ip, f); }
  f.n++;
}

app.post("/api/login", (req, res) => {
  if (isLocked(req.ip)) return res.status(429).json({ error: "Too many wrong attempts. Try again in 15 minutes." });
  const { password } = req.body || {};
  const { salt, hash } = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  const ok = typeof password === "string" && password.length <= 200 && safeEqualHex(hashPw(password, salt), hash);
  if (!ok) { recordFail(req.ip); return res.status(401).json({ error: "Wrong password" }); }
  fails.delete(req.ip);
  if (sessions.size > 50) sessions.delete(sessions.keys().next().value);
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_MS);
  const usingDefault = safeEqualHex(hashPw("admin123", salt), hash);
  res.json({ token, usingDefault });
});

function requireAdmin(req, res, next) {
  const t = req.get("x-admin-token");
  const exp = t && sessions.get(t);
  if (!exp || exp < Date.now()) { if (t) sessions.delete(t); return res.status(401).json({ error: "Not logged in" }); }
  next();
}

app.post("/api/logout", requireAdmin, (req, res) => { sessions.delete(req.get("x-admin-token")); res.json({ ok: true }); });

app.post("/api/password", requireAdmin, writeLimit, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string" || password.length < 6 || password.length > 200) return res.status(400).json({ error: "Use 6 to 200 characters" });
  saveAuth(password);
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

/* ───────────── storage (JSON files, validated) ───────────── */
const ID = "[a-zA-Z0-9_-]{1,40}";
const KEY_RE = new RegExp(`^(portfolio-data|resume|pdf:${ID}|img:${ID})$`);
const fileFor = (k) => path.join(DATA_DIR, "kv_" + k.replace(":", "__") + ".json");
const B64 = /^[A-Za-z0-9+/=]+$/;

function validateValue(key, value) {
  if (key === "portfolio-data") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid data";
    if (JSON.stringify(value).length > 3_000_000) return "Data too large";
    return null;
  }
  if (key === "resume" || key.startsWith("pdf:")) {
    if (typeof value !== "string" || !B64.test(value)) return "Invalid file";
    if (value.length > 4_400_000) return "File too large";
    if (!Buffer.from(value.slice(0, 16), "base64").toString("latin1").startsWith("%PDF")) return "Not a PDF";
    return null;
  }
  if (key.startsWith("img:")) {
    if (!value || typeof value.b64 !== "string" || !B64.test(value.b64)) return "Invalid image";
    if (!["image/jpeg", "image/png", "image/webp"].includes(value.mime)) return "Unsupported image type";
    if (value.b64.length > 6_000_000) return "Image too large";
    const h = Buffer.from(value.b64.slice(0, 16), "base64");
    const okMagic =
      (value.mime === "image/jpeg" && h[0] === 0xff && h[1] === 0xd8) ||
      (value.mime === "image/png" && h[0] === 0x89 && h[1] === 0x50) ||
      (value.mime === "image/webp" && h.toString("latin1", 0, 4) === "RIFF");
    return okMagic ? null : "Image content does not match its type";
  }
  return "Unknown key";
}

let lastBackup = 0;
function backupData(file) {
  try {
    const now = Date.now();
    if (now - lastBackup < 10 * 60_000 || !fs.existsSync(file)) return;
    lastBackup = now;
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(file, path.join(BACKUP_DIR, `portfolio-data-${stamp}.json`));
    const old = fs.readdirSync(BACKUP_DIR).filter((n) => n.startsWith("portfolio-data-")).sort();
    while (old.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, old.shift()));
  } catch (e) { console.error("Backup failed:", e.message); }
}

app.get("/api/kv/:key", (req, res) => {
  const { key } = req.params;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: "Bad key" });
  const f = fileFor(key);
  if (!fs.existsSync(f)) return res.status(404).json({ error: "Not found" });
  res.set("Cache-Control", "no-cache").type("json").send(fs.readFileSync(f, "utf8"));
});

app.put("/api/kv/:key", requireAdmin, writeLimit, (req, res) => {
  const { key } = req.params;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: "Bad key" });
  if (!req.body || !("value" in req.body)) return res.status(400).json({ error: "Missing value" });
  const bad = validateValue(key, req.body.value);
  if (bad) return res.status(400).json({ error: bad });
  const f = fileFor(key);
  if (key === "portfolio-data") backupData(f);
  fs.writeFileSync(f + ".tmp", JSON.stringify({ value: req.body.value }));
  fs.renameSync(f + ".tmp", f); // atomic: a crash can never leave a half-written file
  res.json({ ok: true });
});

app.delete("/api/kv/:key", requireAdmin, writeLimit, (req, res) => {
  const { key } = req.params;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: "Bad key" });
  if (key === "portfolio-data") return res.status(400).json({ error: "Cannot delete main data" });
  const f = fileFor(key);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

// Gallery images are served as real image files so browsers can cache them.
app.get("/api/img/:id", (req, res) => {
  const { id } = req.params;
  if (!new RegExp(`^${ID}$`).test(id)) return res.status(400).end();
  const f = fileFor(`img:${id}`);
  if (!fs.existsSync(f)) return res.status(404).end();
  try {
    const { mime, b64 } = JSON.parse(fs.readFileSync(f, "utf8")).value;
    res.set({ "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" }).end(Buffer.from(b64, "base64"));
  } catch { res.status(500).end(); }
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

/* ───────────── serve the built site ───────────── */
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, {
    setHeaders: (res, p) => {
      if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else res.setHeader("Cache-Control", "no-cache");
    },
  }));
  app.get("*", (req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(DIST, "index.html")));
}

/* ───────────── errors + shutdown ───────────── */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === "entity.too.large") return res.status(413).json({ error: "File too large" });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Bad request" });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));

const server = app.listen(PORT, () => console.log(`Portfolio server on http://localhost:${PORT}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));

