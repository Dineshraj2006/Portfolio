// Talks to the Express server. Reads are public; writes need the admin token.
const TOKEN_KEY = "portfolio-admin-token";
const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };
const url = (key) => `/api/kv/${encodeURIComponent(key)}`;

async function call(u, opts = {}, ms = 60000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(u, { ...opts, signal: ctl.signal }); } finally { clearTimeout(timer); }
}

export const hasToken = () => !!getToken();

export async function sget(key) {
  try {
    const r = await call(url(key), { cache: "no-store" }, 20000);
    if (!r.ok) return null;
    return (await r.json()).value ?? null;
  } catch { return null; }
}

// Returns { ok, status }. status 401 = not logged in or session expired, 0 = network problem.
export async function sset(key, value) {
  const token = getToken();
  if (!token) return { ok: false, status: 401 };
  try {
    const r = await call(url(key), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ value }),
    });
    if (r.status === 401) setToken(null);
    return { ok: r.ok, status: r.status };
  } catch { return { ok: false, status: 0 }; }
}

export async function sdel(key) {
  const token = getToken();
  if (!token) return { ok: false, status: 401 };
  try {
    const r = await call(url(key), { method: "DELETE", headers: { "x-admin-token": token } }, 20000);
    if (r.status === 401) setToken(null);
    return { ok: r.ok, status: r.status };
  } catch { return { ok: false, status: 0 }; }
}

// Returns { ok, usingDefault } or { ok:false, reason: "wrong" | "locked" | "network" }
export async function login(password) {
  try {
    const r = await call("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }, 20000);
    if (r.status === 429) return { ok: false, reason: "locked" };
    if (!r.ok) return { ok: false, reason: "wrong" };
    const j = await r.json();
    setToken(j.token);
    return { ok: true, usingDefault: !!j.usingDefault };
  } catch { return { ok: false, reason: "network" }; }
}

export function logout() {
  const t = getToken();
  setToken(null);
  if (t) call("/api/logout", { method: "POST", headers: { "x-admin-token": t } }, 8000).catch(() => {});
}

export async function changePassword(password) {
  const token = getToken();
  if (!token) return { ok: false, status: 401 };
  try {
    const r = await call("/api/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ password }),
    }, 20000);
    return { ok: r.ok, status: r.status };
  } catch { return { ok: false, status: 0 }; }
}

