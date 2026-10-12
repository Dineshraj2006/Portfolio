import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Sun, Moon, Plus, Minus, Download, Eye, Github, Linkedin, Mail, Phone,
  ExternalLink, Trash2, Upload, Lock, X, LogOut, Check, ArrowUp, ArrowDown,
} from "lucide-react";
import { sget, sset, sdel, login, logout as clearSession, changePassword as apiChangePassword } from "./storage.js";
import { SCENES, HERO_BACKGROUNDS } from "./scenes.js";

/* ───────────── helpers ───────────── */
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hash = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return String(h); };
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const fileToB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(new Error("Could not read file"));
  r.readAsDataURL(file);
});
async function blobUrlFor(key) {
  const b64 = await sget(key);
  if (!b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}
async function downloadPdf(key, name) {
  const url = await blobUrlFor(key);
  if (!url) return;
  const a = document.createElement("a");
  a.href = url; a.download = `${name.replace(/[^\w\-]+/g, "_")}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
}
function resizeImage(file, max = 1600, quality = 0.85) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Could not read this image. Try a JPG or PNG.")); };
    img.src = url;
  });
}
const resizePhoto = (file) => resizeImage(file, 520, 0.82);
const failMsg = (r) =>
  r.status === 401 ? "Session expired. Log out and log in again."
    : r.status === 413 ? "That file is too large."
      : r.status === 0 ? "No connection to the server. Try again."
        : "Upload failed. Try again.";

/* ───────────── availability (Idle / Busy) ───────────── */
const fmtIST = (ms) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ms)) + " IST";
const istInput = (offsetMs = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetMs).toISOString().slice(0, 16);
const parseIST = (v) => (v ? Date.parse(`${v}:00+05:30`) : NaN);
const STATUS_COLORS = { idle: "#1FB66B", busy: "#E5484D" };
const MODES = [
  { id: "immediate_idle", label: "Idle now", hint: "Free to talk right away", state: "idle", scheduled: false },
  { id: "immediate_busy", label: "Busy now", hint: "Busy right away", state: "busy", scheduled: false },
  { id: "scheduled_idle", label: "Scheduled idle", hint: "Free during a time window", state: "idle", scheduled: true },
  { id: "scheduled_busy", label: "Scheduled busy", hint: "Busy during a time window", state: "busy", scheduled: true },
];
// Scheduled X means X inside the window and the opposite outside it. A broken schedule falls back to idle.
function describeStatus(av, now) {
  const m = MODES.find((x) => x.id === av.mode) || MODES[0];
  const other = m.state === "idle" ? "busy" : "idle";
  const name = (st) => (st === "idle" ? "Free to talk" : "Busy");
  let state = m.state, detail = "", invalid = false;
  if (m.scheduled) {
    const start = parseIST(av.start), end = parseIST(av.end);
    if (isNaN(start) || isNaN(end) || end <= start) { state = "idle"; invalid = true; }
    else if (now >= start && now < end) detail = `Until ${fmtIST(end)}`;
    else if (now < start) { state = other; detail = `${name(m.state)} from ${fmtIST(start)} to ${fmtIST(end)}`; }
    else state = other;
  }
  return { state, label: name(state), detail, invalid, color: STATUS_COLORS[state], note: (av.note || "").trim() };
}
function useNow(ms = 30000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

/* ───────────── default content ───────────── */
const DEFAULTS = {
  profile: {
    name: "Your Name",
    tagline: "Computer science student who solves problems daily and ships projects.",
    bio: "Write a few sentences about yourself here: what you study, what you enjoy building, and what you want to do next. Edit this from the admin page.",
    photo: "",
    hasResume: false,
  },
  leet: { base: 0, checks: Array(10).fill(false), date: today() },
  projectsCount: 0,
  projects: [{ id: "p1", title: "Sample project", description: "Describe what the project does. Upload its PDF report from the admin page.", hasPdf: false }],
  achievements: [{ id: "a1", text: "Sample: add your hackathon wins, awards and rankings here" }],
  certs: [{ id: "c1", name: "Sample certification", issuer: "Issuer", link: "" }],
  education: [{ id: "e1", college: "Your College", degree: "B.Tech, Computer Science", cgpa: "8.5", coursework: "Data Structures, Operating Systems, DBMS, Computer Networks" }],
  skills: [
    { id: "s1", name: "Python", level: 85 }, { id: "s2", name: "Java", level: 75 },
    { id: "s3", name: "C++", level: 70 }, { id: "s4", name: "SQL", level: 70 },
    { id: "s5", name: "React", level: 65 }, { id: "s6", name: "DSA", level: 80 },
  ],
  openSource: [],
  researchPapers: [],
  details: [
    { id: "d1", label: "Location", value: "Your city" },
    { id: "d2", label: "Studying", value: "Your course and college" },
    { id: "d3", label: "Interests", value: "Web development, algorithms" },
  ],
  gallery: [],
  availability: { mode: "immediate_idle", start: "", end: "", note: "" },
  hero: { bg: "saturn" },
  blog: [{ id: "b1", title: "Sample note: two pointers pattern", date: today(), body: "Write what you learned from a problem or topic. Short notes are fine." }],
  learning: "Currently learning system design",
  contact: { email: "", phone: "", linkedin: "", github: "", leetcode: "" },
  seo: { title: "Portfolio", description: "Portfolio: projects, skills, achievements and coding profiles." },
};
const rollover = (d) => {
  if (d.leet.date !== today()) {
    d.leet.base += d.leet.checks.filter(Boolean).length;
    d.leet.checks = Array(10).fill(false);
    d.leet.date = today();
  }
  return d;
};
const PALETTE = ["#8B73D6", "#36A892", "#D77B57", "#6091C4", "#C16E9A", "#92944F", "#52A6B2", "#C38A45"];

/* ───────────── hooks / small components ───────────── */
function useInView(threshold = 0.3) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
}

function CountUp({ value }) {
  const [ref, seen] = useInView();
  const [n, setN] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    if (!seen) return;
    const from = cur.current, to = value, dur = reduceMotion() ? 1 : 1600, t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (to - from) * e);
      cur.current = v; setN(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value]);
  return <span ref={ref}>{n}</span>;
}

function Donut({ skills }) {
  const [ref, seen] = useInView(0.25);
  const [hover, setHover] = useState(null);
  const total = skills.reduce((a, s) => a + s.level, 0) || 1;
  const R = 78, C = 2 * Math.PI * R, gap = skills.length > 1 ? 3 : 0;
  let acc = 0;
  const h = hover !== null ? skills[hover] : null;
  return (
    <div className="donut-wrap" ref={ref}>
      <svg viewBox="0 0 200 200" className="donut" role="img" aria-label="Skill proficiency donut chart">
        <defs>
          <mask id="donut-reveal">
            <circle cx="100" cy="100" r={R} fill="none" stroke="#fff" strokeWidth="44"
              strokeDasharray={C} strokeDashoffset={seen || reduceMotion() ? 0 : C}
              style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(.22,.7,.2,1)" }} />
          </mask>
        </defs>
        <g mask="url(#donut-reveal)" transform="rotate(-90 100 100)">
          {skills.map((s, i) => {
            const len = (s.level / total) * C, dash = Math.max(len - gap, 0.5), off = -acc;
            acc += len;
            return (
              <circle key={s.id} cx="100" cy="100" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={hover === i ? 28 : 22} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={off}
                style={{ transition: "stroke-width .2s", cursor: "pointer", opacity: hover === null || hover === i ? 1 : 0.35 }}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            );
          })}
        </g>
        <text x="100" y="98" textAnchor="middle" className="donut-big">{h ? `${h.level}%` : skills.length}</text>
        <text x="100" y="118" textAnchor="middle" className="donut-small">{h ? h.name : "skills"}</text>
      </svg>
      <ul className="legend">
        {skills.map((s, i) => (
          <li key={s.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            className={hover === i ? "on" : ""}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            <span>{s.name}</span><b>{s.level}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeroScene({ mode }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    const make = SCENES[mode];
    const ctx = cv && cv.getContext && cv.getContext("2d");
    if (!ctx || !make) return;
    const still = reduceMotion();
    const m = { x: 0, y: 0, tx: 0, ty: 0, px: 0, py: 0, inside: false, boost: 0 };
    let scene = null, w = 0, h = 0, raf = 0, visible = true, last = performance.now();
    const frame = (dt, now) => { ctx.clearRect(0, 0, w, h); scene.draw(ctx, now / 1000, dt, m); };
    const resize = () => {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height || (scene && Math.abs(r.width - w) < 1 && Math.abs(r.height - h) < 1)) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene = make(w, h);
      if (still) frame(0, 0);
    };
    const tick = (now) => {
      raf = 0;
      if (!visible || !scene) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = Math.min(1, dt * 4);
      m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k;
      m.boost *= Math.pow(0.2, dt);
      frame(dt, now);
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!raf && !still && visible) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    const onMove = (e) => {
      const r = cv.getBoundingClientRect();
      m.px = e.clientX - r.left; m.py = e.clientY - r.top;
      m.inside = m.px >= 0 && m.py >= 0 && m.px <= r.width && m.py <= r.height;
      m.tx = m.inside ? (m.px / r.width - 0.5) * 2 : 0;
      m.ty = m.inside ? (m.py / r.height - 0.5) * 2 : 0;
    };
    const onDown = (e) => { onMove(e); if (m.inside) m.boost = 1; };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(cv); else window.addEventListener("resize", resize);
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }) : null;
    if (io) io.observe(cv);
    if (!still) { window.addEventListener("pointermove", onMove, { passive: true }); window.addEventListener("pointerdown", onDown, { passive: true }); }
    start();
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [mode]);
  return <canvas ref={ref} className="scene" aria-hidden="true" />;
}

function Dot({ color }) { return <i className="pdot" style={{ "--st": color }} />; }

function StatusPing({ av, now }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const s = describeStatus(av, now);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("touchstart", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="ping-wrap" ref={ref}>
      <button className="ping" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Availability: ${s.label}. Tap for details`}>
        <Dot color={s.color} /><span className="ping-label">{s.label}</span>
      </button>
      {open && (
        <div className="ping-pop" role="status">
          <strong><Dot color={s.color} />{s.state === "idle" ? "Idle" : "Busy"}</strong>
          <div>{s.state === "idle" ? "Free to be approached" : "Please give me some time"}</div>
          {s.detail && <div className="mut">{s.detail}</div>}
          {s.note && <div className="ping-note">{s.note}</div>}
        </div>
      )}
    </div>
  );
}

function PdfModal({ viewer, onClose }) {
  if (!viewer) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={viewer.title} onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-bar">
          <strong>{viewer.title}</strong>
          <span className="row">
            {viewer.url && <a className="btn ghost sm" href={viewer.url} download={`${viewer.title.replace(/[^\w\-]+/g, "_")}.pdf`}><Download size={15} />Download</a>}
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </span>
        </div>
        {viewer.loading ? <p className="pad">Loading PDF…</p>
          : viewer.url ? <iframe title={viewer.title} src={viewer.url} className="pdf-frame" />
          : <p className="pad">This PDF could not be loaded.</p>}
      </div>
    </div>
  );
}

/* ───────────── public page ───────────── */
function PublicPage({ data, dark, setDark, openAdmin }) {
  const [viewer, setViewer] = useState(null);
  const [msg, setMsg] = useState({ name: "", text: "" });
  const [openPost, setOpenPost] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const now = useNow();
  const st = describeStatus(data.availability, now);
  const bg = SCENES[data.hero?.bg] ? data.hero.bg : "none";
  const { profile: p, contact: c } = data;
  const leetTotal = data.leet.base + data.leet.checks.filter(Boolean).length;
  const ghUser = (c.github || "").replace(/\/$/, "").split("/").pop();
  const lcUser = (c.leetcode || "").replace(/\/$/, "").split("/").pop();

  const view = async (key, title) => {
    setViewer({ title, loading: true });
    const url = await blobUrlFor(key);
    setViewer({ title, url });
  };
  const closeViewer = () => { if (viewer?.url) URL.revokeObjectURL(viewer.url); setViewer(null); };
  const mailto = `mailto:${c.email}?subject=${encodeURIComponent("Hello from your portfolio")}&body=${encodeURIComponent(`${msg.text}\n\n${msg.name}`)}`;
  const ext = (u) => (u && !/^https?:\/\//.test(u) ? `https://${u}` : u);

  useEffect(() => {
    if (!lightbox) return;
    const esc = (e) => { if (e.key === "Escape") setLightbox(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [lightbox]);

  // sections slide in as you scroll
  useEffect(() => {
    if (reduceMotion() || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.08 });
    document.querySelectorAll(".sec:not(.in)").forEach((el) => { el.classList.add("rv"); io.observe(el); });
    return () => io.disconnect();
  }, [data]);

  return (
    <>
      <header className="nav">
        <a href="#top" className="brand">{p.name}</a>
        <nav aria-label="Sections">
          {["skills", "projects", "achievements", "research", "gallery", "profiles", "blog", "contact"].map((s) => <a key={s} href={`#${s}`}>{s[0].toUpperCase() + s.slice(1)}</a>)}
        </nav>
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <StatusPing av={data.availability} now={now} />
      </header>

      <section className={`hero ${bg !== "none" ? "space" : ""}`} id="top">
        {bg !== "none" && <HeroScene mode={bg} />}
        <div className="hero-text">
          <div className="avatar">
            {p.photo ? <img src={p.photo} alt={`Portrait of ${p.name}`} /> : <span>{p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>}
          </div>
          <div className="chips">
            <p className="status-chip" style={{ "--st": st.color }}><Dot color={st.color} />{st.label}{st.detail ? ` · ${st.detail}` : ""}</p>
            {data.learning && <p className="badge"><i />{data.learning}</p>}
          </div>
          <h1><span className="mark">{p.name}</span></h1>
          <p className="tagline">{p.tagline}</p>
          <div className="row wrap">
            {p.hasResume && <button className="btn" onClick={() => downloadPdf("resume", `${p.name}-resume`)}><Download size={16} />Download resume</button>}
            <a className="btn ghost" href="#contact">Get in touch</a>
          </div>
        </div>
      </section>

      {data.skills.length > 0 && (
        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {[0, 1, 2, 3].map((k) => data.skills.map((sk) => <span key={`${k}-${sk.id}`}>{sk.name}</span>))}
          </div>
        </div>
      )}

      <section className="stats" aria-label="Highlights">
        {[["LeetCode solved", leetTotal], ["Projects done", data.projectsCount], ["Achievements", data.achievements.length], ["Research papers", data.researchPapers.length]].map(([l, v]) => (
          <div key={l} className="stat"><div className="num"><CountUp value={v} /></div><div className="lbl">{l}</div></div>
        ))}
      </section>

      <main>
        <section className="sec two" id="about">
          <div>
            <h2>About me</h2>
            <p className="prose">{p.bio}</p>
            {data.details.some((x) => x.label || x.value) && (
              <dl className="details">
                {data.details.filter((x) => x.label || x.value).map((x) => (
                  <React.Fragment key={x.id}><dt>{x.label}</dt><dd>{x.value}</dd></React.Fragment>
                ))}
              </dl>
            )}
          </div>
          {data.education.length > 0 && (
            <div>
              <h2>Education</h2>
              {data.education.map((e) => (
                <div key={e.id} className="edu">
                  <strong>{e.college}</strong>
                  <span>{e.degree}{e.cgpa ? ` · CGPA ${e.cgpa}` : ""}</span>
                  {e.coursework && <small>{e.coursework}</small>}
                </div>
              ))}
            </div>
          )}
        </section>

        {data.skills.length > 0 && (
          <section className="sec" id="skills">
            <h2>Technical skills</h2>
            <Donut skills={data.skills} />
          </section>
        )}

        {data.projects.length > 0 && (
          <section className="sec" id="projects">
            <h2>Projects</h2>
            <div className="proj-grid">
              {data.projects.map((pr) => (
                <article key={pr.id} className="proj">
                  <h3>{pr.title}</h3>
                  <p>{pr.description}</p>
                  {pr.hasPdf ? (
                    <div className="row wrap">
                      <button className="btn sm" onClick={() => view(`pdf:${pr.id}`, pr.title)}><Eye size={15} />View PDF</button>
                      <button className="btn ghost sm" onClick={() => downloadPdf(`pdf:${pr.id}`, pr.title)}><Download size={15} />Download</button>
                    </div>
                  ) : <small className="mut">PDF not added yet</small>}
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="sec two" id="achievements">
          <div>
            <h2>Achievements</h2>
            <ul className="rules">{data.achievements.map((a) => <li key={a.id}>{a.text}</li>)}</ul>
          </div>
          <div>
            <h2>Certifications</h2>
            <ul className="rules">
              {data.certs.map((x) => (
                <li key={x.id}>
                  <strong>{x.name}</strong>{x.issuer && <span className="mut"> · {x.issuer}</span>}
                  {x.link && <a className="verify" href={ext(x.link)} target="_blank" rel="noreferrer">Verify <ExternalLink size={13} /></a>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {data.gallery.length > 0 && (
          <section className="sec" id="gallery">
            <h2>Gallery</h2>
            <div className="gallery">
              {data.gallery.map((g) => (
                <figure className="shot" key={g.id}>
                  <button onClick={() => setLightbox(g)} aria-label={g.caption ? `Open image: ${g.caption}` : "Open image"}>
                    <img src={`/api/img/${g.id}`} alt={g.caption || "Gallery image"} loading="lazy" />
                  </button>
                  {g.caption && <figcaption>{g.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </section>
        )}

        {(ghUser || lcUser) && (
          <section className="sec" id="profiles">
            <h2>Coding profiles</h2>
            {ghUser && (
              <figure className="live">
                <figcaption>GitHub contributions · <a href={`https://github.com/${ghUser}`} target="_blank" rel="noreferrer">@{ghUser}</a></figcaption>
                <img src={`https://ghchart.rshah.org/${dark ? "7C9BFF" : "2D56F0"}/${ghUser}`} alt={`GitHub contribution graph for ${ghUser}`}
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </figure>
            )}
            {lcUser && (
              <figure className="live">
                <figcaption>LeetCode rating and heatmap · <a href={`https://leetcode.com/${lcUser}`} target="_blank" rel="noreferrer">{lcUser}</a></figcaption>
                <img src={`https://leetcard.jacoblin.cool/${lcUser}?theme=${dark ? "dark" : "light"}&ext=heatmap`} alt={`LeetCode stats for ${lcUser}`}
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </figure>
            )}
          </section>
        )}

        {data.openSource.length > 0 && (
          <section className="sec" id="opensource">
            <h2>Open source contributions</h2>
            <ul className="rules">
              {data.openSource.map((o) => (
                <li key={o.id}><strong>{o.repo}</strong> <span className="mut">{o.desc}</span>
                  {o.link && <a className="verify" href={ext(o.link)} target="_blank" rel="noreferrer">View <ExternalLink size={13} /></a>}</li>
              ))}
            </ul>
          </section>
        )}

        {data.researchPapers.length > 0 && (
          <section className="sec" id="research">
            <h2>Research papers</h2>
            <ul className="rules">
              {data.researchPapers.map((r) => (
                <li key={r.id}>
                  <strong>{r.title}</strong>
                  <div className="mut">
                    {[r.authors, r.venue, r.year].filter(Boolean).join(" · ")}
                    {r.status ? ` · ${r.status}` : ""}
                  </div>
                  {r.summary && <p className="mut" style={{ margin: "6px 0 0", maxWidth: "64ch" }}>{r.summary}</p>}
                  {r.link && (
                    <a className="verify" style={{ marginLeft: 0 }} href={ext(r.link)} target="_blank" rel="noreferrer">
                      Read paper <ExternalLink size={13} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.blog.length > 0 && (
          <section className="sec" id="blog">
            <h2>Notes and blog</h2>
            <div className="posts">
              {data.blog.map((b) => (
                <article key={b.id} className="post">
                  <button onClick={() => setOpenPost(openPost === b.id ? null : b.id)} aria-expanded={openPost === b.id}>
                    <span>{b.title}</span><small>{b.date}</small>
                  </button>
                  {openPost === b.id && <p>{b.body}</p>}
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="sec two" id="contact">
          <div>
            <h2>Contact</h2>
            <ul className="contact-list">
              {c.email && <li><Mail size={17} /><a href={`mailto:${c.email}`}>{c.email}</a></li>}
              {c.phone && <li><Phone size={17} /><a href={`tel:${c.phone}`}>{c.phone}</a></li>}
              {c.linkedin && <li><Linkedin size={17} /><a href={ext(c.linkedin)} target="_blank" rel="noreferrer">LinkedIn</a></li>}
              {c.github && <li><Github size={17} /><a href={ext(c.github.includes("/") ? c.github : `github.com/${c.github}`)} target="_blank" rel="noreferrer">GitHub</a></li>}
              {c.leetcode && <li><ExternalLink size={17} /><a href={ext(c.leetcode.includes("/") ? c.leetcode : `leetcode.com/${c.leetcode}`)} target="_blank" rel="noreferrer">LeetCode</a></li>}
              {!c.email && !c.phone && !c.linkedin && !c.github && !c.leetcode && <li className="mut">Contact details are added from the admin page.</li>}
            </ul>
          </div>
          <div>
            <h2>Send a message</h2>
            <div className="stack">
              <label className="fld"><span>Your name</span><input value={msg.name} onChange={(e) => setMsg({ ...msg, name: e.target.value })} /></label>
              <label className="fld"><span>Message</span><textarea rows={4} value={msg.text} onChange={(e) => setMsg({ ...msg, text: e.target.value })} /></label>
              {c.email
                ? <a className="btn" href={mailto}><Mail size={16} />Open in email app</a>
                : <small className="mut">Add an email in the admin page to enable this form.</small>}
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>© {new Date().getFullYear()} {p.name}</span>
        <button className="link-btn" onClick={openAdmin}><Lock size={13} />Admin</button>
      </footer>
      <PdfModal viewer={viewer} onClose={closeViewer} />
      {lightbox && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Image" onClick={() => setLightbox(null)}>
          <figure className="lightbox" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn lb-close" onClick={() => setLightbox(null)} aria-label="Close"><X size={18} /></button>
            <img src={`/api/img/${lightbox.id}`} alt={lightbox.caption || "Gallery image"} />
            {lightbox.caption && <figcaption>{lightbox.caption}</figcaption>}
          </figure>
        </div>
      )}
    </>
  );
}

/* ───────────── admin ───────────── */
function ListEditor({ items, fields, onChange, make, addLabel }) {
  const set = (id, k, v) => onChange(items.map((it) => (it.id === id ? { ...it, [k]: v } : it)));
  return (
    <div className="stack">
      {items.map((it) => (
        <div className="ed-item" key={it.id}>
          {fields.map((f) => (
            <label key={f.k} className="fld">
              <span>{f.label}{f.type === "range" ? `: ${it[f.k]}%` : ""}</span>
              {f.area
                ? <textarea rows={3} value={it[f.k] || ""} onChange={(e) => set(it.id, f.k, e.target.value)} />
                : <input type={f.type || "text"} min={0} max={100} value={it[f.k] ?? ""}
                    onChange={(e) => set(it.id, f.k, f.type === "range" || f.type === "number" ? Number(e.target.value) : e.target.value)} />}
            </label>
          ))}
          <button className="icon-btn danger" onClick={() => onChange(items.filter((x) => x.id !== it.id))} aria-label="Remove item"><Trash2 size={16} /></button>
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => onChange([...items, make()])}><Plus size={15} />{addLabel}</button>
    </div>
  );
}

function PdfPicker({ has, onFile, onRemove, label }) {
  const inp = useRef(null);
  const [err, setErr] = useState("");
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (f.type !== "application/pdf") return setErr("Choose a PDF file.");
    if (f.size > 3 * 1024 * 1024) return setErr("PDF must be under 3 MB.");
    setErr("");
    try { await onFile(f); } catch (e) { setErr(e.message || "Upload failed. Try again."); }
  };
  return (
    <div className="pdf-pick">
      <input ref={inp} type="file" accept="application/pdf" hidden onChange={pick} />
      <button className="btn ghost sm" onClick={() => inp.current.click()}><Upload size={15} />{has ? `Replace ${label}` : `Upload ${label}`}</button>
      {has && <><span className="ok"><Check size={14} />PDF uploaded</span><button className="link-btn danger" onClick={onRemove}>Remove PDF</button></>}
      {err && <span className="err">{err}</span>}
    </div>
  );
}

function StatusPanel({ av, update, now }) {
  const s = describeStatus(av, now);
  const m = MODES.find((x) => x.id === av.mode) || MODES[0];
  const set = (patch) => update((d) => { d.availability = { ...d.availability, ...patch }; return d; });
  const pick = (id) => {
    const next = { mode: id };
    if (MODES.find((x) => x.id === id).scheduled && (!av.start || !av.end)) { next.start = istInput(); next.end = istInput(2 * 3600e3); }
    set(next);
  };
  const badWindow = m.scheduled && (isNaN(parseIST(av.start)) || isNaN(parseIST(av.end)) || parseIST(av.end) <= parseIST(av.start));
  return (
    <section className="panel status-panel">
      <div className="status-head">
        <h2>Availability</h2>
        <p className="chip"><Dot color={s.color} />Visitors see: <b>{s.label}</b></p>
      </div>
      <div className="modes" role="radiogroup" aria-label="Availability mode">
        {MODES.map((x) => (
          <button key={x.id} role="radio" aria-checked={av.mode === x.id} className={`mode ${av.mode === x.id ? "on" : ""}`} onClick={() => pick(x.id)}>
            <Dot color={STATUS_COLORS[x.state]} /><span><b>{x.label}</b><small>{x.hint}</small></span>
          </button>
        ))}
      </div>
      {m.scheduled && (
        <div className="when">
          <label className="fld"><span>From (India time)</span><input type="datetime-local" value={av.start || ""} onChange={(e) => set({ start: e.target.value })} /></label>
          <label className="fld"><span>To (India time)</span><input type="datetime-local" value={av.end || ""} onChange={(e) => set({ end: e.target.value })} /></label>
        </div>
      )}
      {badWindow && <p className="err">Pick a start and an end time, with the end after the start. Until then visitors see Free to talk.</p>}
      {m.scheduled && !badWindow && s.detail && <p className="mut">{s.detail}</p>}
      <label className="fld"><span>Note for visitors (optional)</span>
        <input maxLength={120} value={av.note || ""} placeholder="e.g. In exams until Friday" onChange={(e) => set({ note: e.target.value })} /></label>
    </section>
  );
}

function SaveBadge({ state, retry, relogin }) {
  const map = {
    saving: ["Saving…", ""], saved: ["All changes saved", "ok"], retrying: ["Could not save. Retrying…", "err"],
    error: ["Not saved. Check your connection.", "err"], auth: ["Session expired.", "err"],
  };
  const [text, cls] = map[state] || map.saved;
  return (
    <span className={`savebadge ${cls}`} role="status">{text}
      {state === "error" && <button className="link-btn" onClick={retry}>Retry</button>}
      {state === "auth" && <button className="link-btn" onClick={relogin}>Log in again</button>}
    </span>
  );
}

function ImagesAdmin({ data, update }) {
  const inp = useRef(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const MAX = 40;
  const add = async (files) => {
    setErr("");
    const list = [...files].slice(0, Math.max(0, MAX - data.gallery.length));
    const added = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`Uploading ${i + 1} of ${list.length}…`);
      try {
        const f = list[i];
        if (!f.type.startsWith("image/")) throw new Error(`${f.name} is not an image.`);
        const dataUrl = await resizeImage(f, 1600, 0.85);
        const id = uid() + uid();
        const r = await sset(`img:${id}`, { mime: "image/jpeg", b64: dataUrl.split(",")[1] });
        if (!r.ok) throw new Error(failMsg(r));
        added.push({ id, caption: "" });
      } catch (e) { setErr(e.message); }
    }
    if (added.length) update((d) => { d.gallery.push(...added); return d; });
    setBusy("");
  };
  const move = (i, dir) => update((d) => {
    const j = i + dir;
    if (j < 0 || j >= d.gallery.length) return d;
    [d.gallery[i], d.gallery[j]] = [d.gallery[j], d.gallery[i]];
    return d;
  });
  const remove = async (id) => {
    await sdel(`img:${id}`);
    update((d) => { d.gallery = d.gallery.filter((x) => x.id !== id); return d; });
  };
  return (
    <section className="panel">
      <h2>Gallery images</h2>
      <p className="mut">These appear in the Gallery section of your site. Big photos are shrunk automatically, so phone photos are fine. Up to {MAX} images.</p>
      <input ref={inp} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = e.target.files; if (f?.length) add(f); e.target.value = ""; }} />
      <div className="row wrap">
        <button className="btn" disabled={!!busy || data.gallery.length >= MAX} onClick={() => inp.current.click()}><Upload size={16} />Add images</button>
        {busy && <span className="mut">{busy}</span>}
      </div>
      {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
      <div className="stack" style={{ marginTop: 16 }}>
        {data.gallery.length === 0 && !busy && <p className="mut">No images yet.</p>}
        {data.gallery.map((g, i) => (
          <div className="ed-item gal-item" key={g.id}>
            <img src={`/api/img/${g.id}`} alt="" />
            <div className="stack">
              <label className="fld"><span>Caption (optional)</span>
                <input value={g.caption} maxLength={120} onChange={(e) => update((d) => { d.gallery[i].caption = e.target.value; return d; })} /></label>
              <div className="row">
                <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={15} />Up</button>
                <button className="btn ghost sm" disabled={i === data.gallery.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={15} />Down</button>
              </div>
            </div>
            <button className="icon-btn danger" onClick={() => remove(g.id)} aria-label="Delete image"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdminPage({ data, update, exit, changePassword, logout, save, retry, relogin, usingDefault }) {
  const [tab, setTab] = useState("today");
  const [pw, setPw] = useState({ a: "", b: "", note: "" });
  const checks = data.leet.checks;
  const done = checks.filter(Boolean).length;
  const photoRef = useRef(null);
  const [photoErr, setPhotoErr] = useState("");
  const now = useNow();

  const setField = (path, v) => update((d) => { const [a, b] = path.split("."); b ? (d[a][b] = v) : (d[a] = v); return d; });
  const field = (path, label, props = {}) => {
    const [a, b] = path.split(".");
    const val = b ? data[a][b] : data[a];
    return (
      <label className="fld"><span>{label}</span>
        {props.area ? <textarea rows={4} value={val} onChange={(e) => setField(path, e.target.value)} />
          : <input value={val} onChange={(e) => setField(path, e.target.value)} {...props} />}
      </label>
    );
  };
  const uploadProjectPdf = async (id, file) => {
    const r = await sset(`pdf:${id}`, await fileToB64(file));
    if (!r.ok) throw new Error(failMsg(r));
    update((d) => { d.projects.find((x) => x.id === id).hasPdf = true; return d; });
  };
  const removeProjectPdf = async (id) => {
    await sdel(`pdf:${id}`);
    update((d) => { d.projects.find((x) => x.id === id).hasPdf = false; return d; });
  };

  const tabs = [["today", "Today"], ["projects", "Project PDFs"], ["images", "Images"], ["content", "Content"], ["profile", "Profile and contact"], ["security", "Password"]];
  return (
    <div className="admin">
      <div className="admin-top">
        <div className="admin-heading">
          <p className="admin-eyebrow">PORTFOLIO STUDIO</p>
          <h1>Dashboard</h1>
          <p className="admin-subtitle">Manage your portfolio. Changes save automatically.</p>
        </div>
        <span className="row"><SaveBadge state={save} retry={retry} relogin={relogin} /><button className="btn ghost sm" onClick={exit}>View public page</button></span>
      </div>
      {usingDefault && <p className="banner">You are still using the starting password (admin123). That is fine while you build, but change it under Password before you share your site.</p>}
      <StatusPanel av={data.availability} update={update} now={now} />
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === "today" && (
        <div className="stack gap">
          <section className="panel">
            <h2>LeetCode today</h2>
            <p className="mut">{done} of 10 done today. Ticking a box adds to the public count. The boxes reset at midnight and the day's solves stay in the total.</p>
            <div className="boxes">
              {checks.map((on, i) => (
                <button key={i} className={`box ${on ? "on" : ""}`} aria-pressed={on} aria-label={`Problem ${i + 1}`}
                  onClick={() => update((d) => { d.leet.checks[i] = !d.leet.checks[i]; return d; })}>
                  {on ? <Check size={22} /> : i + 1}
                </button>
              ))}
            </div>
            <p><strong>Public count: {data.leet.base + done}</strong></p>
            <label className="fld narrow"><span>Solved before today (starting total)</span>
              <input type="number" min={0} value={data.leet.base} onChange={(e) => update((d) => { d.leet.base = Math.max(0, Number(e.target.value) || 0); return d; })} />
            </label>
          </section>

          <section className="panel">
            <h2>Projects done</h2>
            <p className="mut">This number is what visitors see in the stats row.</p>
            <div className="counter">
              <button className="step" aria-label="Decrease projects" onClick={() => update((d) => { d.projectsCount = Math.max(0, d.projectsCount - 1); return d; })}><Minus size={22} /></button>
              <output aria-live="polite">{data.projectsCount}</output>
              <button className="step" aria-label="Increase projects" onClick={() => update((d) => { d.projectsCount += 1; return d; })}><Plus size={22} /></button>
            </div>
          </section>
        </div>
      )}

      {tab === "projects" && (
        <section className="panel">
          <h2>Project PDFs</h2>
          <p className="mut">Each project shows its PDF on the public page. PDFs must be under 3 MB.</p>
          <div className="stack">
            {data.projects.map((pr) => (
              <div className="ed-item" key={pr.id}>
                <label className="fld"><span>Title</span><input value={pr.title} onChange={(e) => update((d) => { d.projects.find((x) => x.id === pr.id).title = e.target.value; return d; })} /></label>
                <label className="fld"><span>Description</span><textarea rows={3} value={pr.description} onChange={(e) => update((d) => { d.projects.find((x) => x.id === pr.id).description = e.target.value; return d; })} /></label>
                <PdfPicker has={pr.hasPdf} label="project PDF" onFile={(f) => uploadProjectPdf(pr.id, f)} onRemove={() => removeProjectPdf(pr.id)} />
                <button className="icon-btn danger" aria-label="Delete project" onClick={async () => { await sdel(`pdf:${pr.id}`); update((d) => { d.projects = d.projects.filter((x) => x.id !== pr.id); return d; }); }}><Trash2 size={16} /></button>
              </div>
            ))}
            <button className="btn ghost sm" onClick={() => update((d) => { d.projects.push({ id: uid(), title: "New project", description: "", hasPdf: false }); return d; })}><Plus size={15} />Add project</button>
          </div>
        </section>
      )}

      {tab === "images" && <ImagesAdmin data={data} update={update} />}

      {tab === "content" && (
        <div className="stack gap">
          <section className="panel"><h2>Achievements</h2><p className="mut">The count in the stats row follows this list.</p>
            <ListEditor items={data.achievements} onChange={(v) => setField("achievements", v)} addLabel="Add achievement" make={() => ({ id: uid(), text: "" })} fields={[{ k: "text", label: "Achievement" }]} /></section>
          <section className="panel"><h2>Certifications</h2>
            <ListEditor items={data.certs} onChange={(v) => setField("certs", v)} addLabel="Add certification" make={() => ({ id: uid(), name: "", issuer: "", link: "" })}
              fields={[{ k: "name", label: "Name" }, { k: "issuer", label: "Issuer" }, { k: "link", label: "Verify link" }]} /></section>
          <section className="panel"><h2>Education</h2>
            <ListEditor items={data.education} onChange={(v) => setField("education", v)} addLabel="Add education" make={() => ({ id: uid(), college: "", degree: "", cgpa: "", coursework: "" })}
              fields={[{ k: "college", label: "College" }, { k: "degree", label: "Degree" }, { k: "cgpa", label: "CGPA" }, { k: "coursework", label: "Coursework", area: true }]} /></section>
          <section className="panel"><h2>Skills</h2><p className="mut">Each slider sets proficiency. The donut chart sizes each slice by it.</p>
            <ListEditor items={data.skills} onChange={(v) => setField("skills", v)} addLabel="Add skill" make={() => ({ id: uid(), name: "", level: 50 })}
              fields={[{ k: "name", label: "Skill" }, { k: "level", label: "Proficiency", type: "range" }]} /></section>
          <section className="panel"><h2>Open source</h2>
            <ListEditor items={data.openSource} onChange={(v) => setField("openSource", v)} addLabel="Add contribution" make={() => ({ id: uid(), repo: "", desc: "", link: "" })}
              fields={[{ k: "repo", label: "Repository" }, { k: "desc", label: "What you contributed" }, { k: "link", label: "Link" }]} /></section>
          <section className="panel"><h2>Research papers</h2>
            <ListEditor items={data.researchPapers} onChange={(v) => setField("researchPapers", v)} addLabel="Add paper"
              make={() => ({ id: uid(), title: "", authors: "", venue: "", year: "", status: "Published", link: "", summary: "" })}
              fields={[
                { k: "title", label: "Title" },
                { k: "authors", label: "Authors" },
                { k: "venue", label: "Journal or conference" },
                { k: "year", label: "Year" },
                { k: "status", label: "Status (Published, Under review, Preprint)" },
                { k: "link", label: "Link (DOI or URL)" },
                { k: "summary", label: "Short summary", area: true },
              ]} /></section>
          <section className="panel"><h2>Blog and notes</h2>
            <ListEditor items={data.blog} onChange={(v) => setField("blog", v)} addLabel="Add post" make={() => ({ id: uid(), title: "", date: today(), body: "" })}
              fields={[{ k: "title", label: "Title" }, { k: "date", label: "Date" }, { k: "body", label: "Text", area: true }]} /></section>
        </div>
      )}

      {tab === "profile" && (
        <div className="stack gap">
          <section className="panel"><h2>Profile</h2><div className="stack">
            {field("profile.name", "Name")}{field("profile.tagline", "Tagline")}{field("profile.bio", "About me", { area: true })}
            {field("learning", "Currently learning or building (leave empty to hide)")}
            <div className="pdf-pick">
              <input ref={photoRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setPhotoErr(""); try { setField("profile.photo", await resizePhoto(f)); } catch (er) { setPhotoErr(er.message); } }} />
              <button className="btn ghost sm" onClick={() => photoRef.current.click()}><Upload size={15} />{data.profile.photo ? "Replace photo" : "Upload photo"}</button>
              {data.profile.photo && <button className="link-btn danger" onClick={() => setField("profile.photo", "")}>Remove photo</button>}
              {photoErr && <span className="err">{photoErr}</span>}
            </div>
            <PdfPicker has={data.profile.hasResume} label="resume" onFile={async (f) => { const r = await sset("resume", await fileToB64(f)); if (!r.ok) throw new Error(failMsg(r)); setField("profile.hasResume", true); }}
              onRemove={async () => { await sdel("resume"); setField("profile.hasResume", false); }} />
          </div></section>
          <section className="panel"><h2>Intro background</h2>
            <p className="mut">The animated scene behind your name at the top of the site. Visitors can move the mouse (or drag a finger) over it, and click to speed it up.</p>
            <div className="modes" role="radiogroup" aria-label="Intro background">
              {HERO_BACKGROUNDS.map((b) => (
                <button key={b.id} role="radio" aria-checked={(data.hero?.bg || "saturn") === b.id} className={`mode ${(data.hero?.bg || "saturn") === b.id ? "on" : ""}`} onClick={() => setField("hero.bg", b.id)}>
                  <span><b>{b.label}</b><small>{b.hint}</small></span>
                </button>
              ))}
            </div>
          </section>
          <section className="panel"><h2>Details in your bio</h2><p className="mut">Short lines shown under your About text, such as Location, College or Languages.</p>
            <ListEditor items={data.details} onChange={(v) => setField("details", v)} addLabel="Add detail" make={() => ({ id: uid(), label: "", value: "" })}
              fields={[{ k: "label", label: "Label (e.g. Location)" }, { k: "value", label: "Value (e.g. Chennai, India)" }]} /></section>
          <section className="panel"><h2>Contact and profiles</h2><div className="stack">
            {field("contact.email", "Email")}{field("contact.phone", "Phone")}{field("contact.linkedin", "LinkedIn URL")}
            {field("contact.github", "GitHub username or URL")}{field("contact.leetcode", "LeetCode username or URL")}
          </div></section>
          <section className="panel"><h2>Search and sharing</h2><div className="stack">
            {field("seo.title", "Page title")}{field("seo.description", "Page description", { area: true })}
          </div></section>
        </div>
      )}

      {tab === "security" && (
        <section className="panel">
          <h2>Change password</h2>
          <p className="mut">The password is checked on the server, and only a logged-in admin can save changes.</p>
          <div className="stack narrow">
            <label className="fld"><span>New password</span><input type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></label>
            <label className="fld"><span>Repeat new password</span><input type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></label>
            <button className="btn sm" onClick={async () => {
              if (pw.a.length < 6) return setPw({ ...pw, note: "Use at least 6 characters." });
              if (pw.a !== pw.b) return setPw({ ...pw, note: "Passwords do not match." });
              const r = await changePassword(pw.a);
              if (!r.ok) return setPw({ ...pw, note: r.status === 401 ? "Session expired. Log in again." : "Could not save the password. Try again." });
              setPw({ a: "", b: "", note: "Password changed." });
            }}>Save password</button>
            {pw.note && <span className="mut">{pw.note}</span>}
          </div>
        </section>
      )}
      <button className="link-btn" onClick={logout}><LogOut size={14} />Log out</button>
    </div>
  );
}

function Login({ onLogin, back }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr("");
    const r = await onLogin(v);
    setBusy(false);
    if (!r.ok) setErr(r.reason === "locked" ? "Too many wrong attempts. Try again in 15 minutes." : r.reason === "network" ? "Cannot reach the server. Is it running?" : "Wrong password.");
  };
  return (
    <div className="login">
      <h1>Admin login</h1>
      <label className="fld"><span>Password</span>
        <input type="password" value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} /></label>
      {err && <span className="err">{err}</span>}
      <div className="row"><button className="btn" onClick={go} disabled={busy}>{busy ? "Checking…" : "Log in"}</button><button className="btn ghost" onClick={back}>Back</button></div>
      <small className="mut">The starting password is admin123 unless the server sets ADMIN_PASSWORD. Change it under Password.</small>
    </div>
  );
}

function DRIntro({ onDone }) {
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onDone, reduced ? 100 : 4400);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  return (
    <div className="dr-intro" role="dialog" aria-label="Dineshraj portfolio intro">
      <div className="dr-intro-glow" aria-hidden="true" />
      <div className="dr-intro-art-wrap" aria-hidden="true">
        <svg className="dr-intro-mark" viewBox="0 0 1672 943" role="img" aria-label="DR monogram">
          <defs>
            <clipPath id="dr-mark-shape" clipPathUnits="userSpaceOnUse">
              <path fillRule="evenodd" d="M301 228 784 298Q802 301 813 315L839 347Q845 355 842 369L799 578Q796 594 780 598L276 676 375 603 456 310 394 294Z M474 321 779 360 741 542 455 590Z" />
              <path d="M830 252 1338 250 1380 294 1358 386 1077 403 1307 602 1308 711 1021 452 1078 404 941 417 864 675 944 676 984 304 903 302Z" />
            </clipPath>
            <linearGradient id="dr-trace-metal" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#68707c" />
              <stop offset=".42" stopColor="#f4f7fb" />
              <stop offset=".7" stopColor="#aeb8c4" />
              <stop offset="1" stopColor="#fff" />
            </linearGradient>
            <linearGradient id="dr-polish-sweep" x1="0" y1=".5" x2="1" y2=".5" gradientUnits="objectBoundingBox">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".46" stopColor="#dbe7f7" stopOpacity="0" />
              <stop offset=".51" stopColor="#fff" stopOpacity=".95" />
              <stop offset=".56" stopColor="#dbe7f7" stopOpacity="0" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <image className="dr-mark-chrome" href="/dr-logo-reveal.png" x="0" y="0" width="1672" height="943" preserveAspectRatio="none" clipPath="url(#dr-mark-shape)" />
          <g className="dr-mark-traces" fill="none" stroke="url(#dr-trace-metal)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
            <path className="dr-trace-d" d="M301 228 784 298 839 347 799 578 276 676 375 603 456 310 394 294Z M474 321 779 360 741 542 455 590Z" />
            <path className="dr-trace-r" d="M830 252 1338 250 1380 294 1358 386 1077 403 1307 602 1308 711 1021 452 1078 404 941 417 864 675 944 676 984 304 903 302Z" />
          </g>
          <rect className="dr-mark-polish" x="0" y="0" width="1672" height="943" fill="url(#dr-polish-sweep)" clipPath="url(#dr-mark-shape)" />
        </svg>
      </div>
      <div className="dr-intro-caption"><span>DR</span><i />PORTFOLIO</div>
      <button className="dr-intro-skip" onClick={onDone}>Skip intro <span aria-hidden="true">↗</span></button>
    </div>
  );
}

/* ───────────── app shell ───────────── */
export default function Portfolio() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("public");
  const [showIntro, setShowIntro] = useState(() => {
    if (typeof window === "undefined" || window.location.hash === "#admin") return false;
    try { return sessionStorage.getItem("dr-logo-draw-intro-v2-seen") !== "1"; } catch { return true; }
  });
  const [dark, setDarkState] = useState(false);
  const [usingDefault, setUsingDefault] = useState(false);
  const [saveState, setSaveStateRaw] = useState("saved");
  const saveStateRef = useRef("saved");
  const setSaveState = (v) => { saveStateRef.current = v; setSaveStateRaw(v); };
  const dataRef = useRef(null);
  const timer = useRef(null);

  const flush = async (attempt) => {
    const r = await sset("portfolio-data", dataRef.current);
    if (r.ok) return setSaveState("saved");
    if (r.status === 401) return setSaveState("auth");
    if (attempt < 3) { setSaveState("retrying"); timer.current = setTimeout(() => flush(attempt + 1), 1500 * (attempt + 1)); }
    else setSaveState("error");
  };
  const persist = () => { clearTimeout(timer.current); setSaveState("saving"); timer.current = setTimeout(() => flush(0), 500); };
  const update = useCallback((fn) => {
    const next = fn(JSON.parse(JSON.stringify(dataRef.current)));
    dataRef.current = next; setData(next); persist();
  }, []);
  const setDark = (v) => { setDarkState(v); try { localStorage.setItem("theme", v ? "dark" : "light"); } catch {} };
  const dismissIntro = useCallback(() => {
    try { sessionStorage.setItem("dr-logo-draw-intro-v2-seen", "1"); } catch {}
    setShowIntro(false);
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await sget("portfolio-data");
      const merged = rollover({ ...JSON.parse(JSON.stringify(DEFAULTS)), ...(saved || {}) });
      dataRef.current = merged; setData(merged);
      if (!saved || saved.leet?.date !== today()) sset("portfolio-data", merged);
      let t = null;
      try { t = localStorage.getItem("theme"); } catch {}
      if (t === null) setDarkState(window.matchMedia?.("(prefers-color-scheme: dark)").matches || false); else setDarkState(t === "dark");
    })();
    const iv = setInterval(() => { if (dataRef.current && dataRef.current.leet.date !== today()) update(rollover); }, 30000);
    return () => clearInterval(iv);
  }, [update]);

  useEffect(() => {
    if (!data) return;
    document.title = data.seo.title;
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement("meta"); m.name = "description"; document.head.appendChild(m); }
    m.content = data.seo.description;
    let l = document.querySelector('link[rel="icon"]');
    if (!l) { l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); }
    l.href = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#101B33'/><text x='32' y='44' font-size='34' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='#A78BFA'>${(data.profile.name[0] || "P").toUpperCase()}</text></svg>`);
  }, [data]);

  // warn before leaving the page while a save is still pending
  useEffect(() => {
    const h = (e) => { if (["saving", "retrying", "error"].includes(saveStateRef.current)) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // open yoursite/#admin to jump straight to the login page
  useEffect(() => {
    const check = () => { if (window.location.hash === "#admin") setView("login"); };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const leaveAdminHash = () => {
    if (window.location.hash === "#admin") history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const tryLogin = async (pass) => {
    const r = await login(pass);
    if (r.ok) {
      setUsingDefault(r.usingDefault);
      setView("admin");
      if (saveStateRef.current === "auth") persist();
    }
    return r;
  };
  const changePassword = async (pw) => {
    const r = await apiChangePassword(pw);
    if (r.ok && pw !== "admin123") setUsingDefault(false);
    return r;
  };
  const doLogout = () => { clearSession(); leaveAdminHash(); setView("public"); };

  if (!data) return <div className="pf" style={{ padding: 40 }}><style>{css}</style>Loading…</div>;
  return (
    <div className={`pf ${dark ? "dark" : ""}`}>
      <style>{css}</style>
      {view === "public" && <PublicPage data={data} dark={dark} setDark={setDark} openAdmin={() => setView("login")} />}
      {view === "public" && showIntro && <DRIntro onDone={dismissIntro} />}
      {view === "login" && <Login onLogin={tryLogin} back={() => { leaveAdminHash(); setView("public"); }} />}
      {view === "admin" && <AdminPage data={data} update={update} exit={() => { leaveAdminHash(); setView("public"); }} changePassword={changePassword} logout={doLogout} save={saveState} retry={persist} relogin={() => setView("login")} usingDefault={usingDefault} />}
    </div>
  );
}

/* ───────────── styles ───────────── */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Figtree:wght@400;500;600&display=swap');
.pf{--bg:#F1F0EC;--paper:#FBFAF7;--ink:#1B202B;--mut:#5C616C;--line:#C6C6C4;--hl:#6553A6;--blue:#46528F;--pink:#B95F4F;--mint:#2B786A;--grid:rgba(27,32,43,.08);--danger:#A9343B;
  background:var(--bg);color:var(--ink);font-family:Figtree,system-ui,sans-serif;font-size:16px;line-height:1.6;min-height:100vh;overflow-x:clip}
.pf.dark{--bg:#090A0D;--paper:#13151A;--ink:#E8E9ED;--mut:#A7A9B0;--line:#292B31;--blue:#766BC2;--hl:#7560B0;--pink:#B76555;--mint:#3A8979;--grid:rgba(232,233,237,.05);--danger:#D97878}
.pf *{box-sizing:border-box}
.pf h1,.pf h2,.pf h3,.pf .num,.pf .brand{font-family:'Bricolage Grotesque',Figtree,system-ui,sans-serif;line-height:1.1;margin:0}
.pf a{color:inherit}
.pf :focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.pf .mut{color:var(--mut)} .pf small{font-size:.85rem}
.pf .row{display:flex;align-items:center;gap:10px} .pf .wrap{flex-wrap:wrap}
.pf .stack{display:flex;flex-direction:column;gap:14px} .pf .gap{gap:22px} .pf .narrow{max-width:360px}

.nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:18px;padding:10px 24px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:2px solid var(--ink)}
.nav .brand{font-weight:800;text-decoration:none;font-size:1.15rem;white-space:nowrap;display:inline-flex;align-items:center;gap:8px}
.nav .brand::before{content:"";width:14px;height:14px;border-radius:50%;background:var(--pink);border:2px solid var(--ink)}
.nav nav{display:flex;gap:6px;overflow-x:auto;flex:1;scrollbar-width:none}
.nav nav a{text-decoration:none;color:var(--ink);font-weight:600;font-size:.92rem;padding:5px 13px;border-radius:99px;white-space:nowrap;transition:background .15s,transform .15s}
.nav nav a:hover{background:var(--hl);color:#101B33;transform:translateY(-1px)}
.icon-btn{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:10px;border:2px solid var(--ink);background:var(--paper);color:var(--ink);cursor:pointer;flex:none;transition:transform .15s,background .15s}
.icon-btn:hover{background:var(--hl);color:#101B33;transform:rotate(-8deg)} .icon-btn.danger{color:var(--danger)}

.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:10px;border:2px solid var(--ink);background:var(--ink);color:var(--bg);font:700 .95rem Figtree,system-ui,sans-serif;text-decoration:none;cursor:pointer;box-shadow:4px 4px 0 var(--blue);transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--blue)}
.btn:active{transform:translate(3px,3px);box-shadow:0 0 0 var(--blue)}
.btn.ghost{background:var(--paper);color:var(--ink);box-shadow:4px 4px 0 var(--hl)}
.btn.ghost:hover{box-shadow:6px 6px 0 var(--hl)} .btn.ghost:active{box-shadow:0 0 0 var(--hl)}
.btn.sm{padding:7px 12px;font-size:.88rem;box-shadow:3px 3px 0 var(--blue)} .btn.ghost.sm{box-shadow:3px 3px 0 var(--hl)}
.link-btn{display:inline-flex;align-items:center;gap:6px;background:none;border:0;color:var(--mut);font:500 .88rem Figtree,system-ui,sans-serif;cursor:pointer;text-decoration:underline;padding:4px 0}
.link-btn.danger{color:var(--danger)}

.hero{position:relative;overflow:hidden;display:grid;grid-template-columns:1.4fr 1fr;gap:40px;align-items:center;padding:84px 24px 76px;max-width:1080px;margin:0 auto}
.hero::before{content:"";position:absolute;right:-110px;top:-110px;width:380px;height:380px;border-radius:50%;background:var(--pink);border:3px solid var(--ink)}
.hero::after{content:"";position:absolute;left:44%;bottom:-70px;width:150px;height:150px;border-radius:50%;border:16px solid var(--hl)}
.hero-text,.photo-frame{position:relative;z-index:1}
.hero h1{font-size:clamp(3rem,9vw,6.2rem);font-weight:800;letter-spacing:-.035em;margin:16px 0 18px}
.mark{background:linear-gradient(transparent 80%,var(--hl) 80%,var(--hl) 95%,transparent 95%);box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:0 .06em}
.tagline{font-size:1.25rem;max-width:34ch;color:var(--ink);opacity:.8;margin:0 0 28px}
.badge{display:inline-flex;align-items:center;gap:8px;margin:0;padding:7px 16px;border:2px solid var(--ink);border-radius:99px;background:var(--hl);color:#101B33;font-weight:700;font-size:.9rem;box-shadow:3px 3px 0 var(--ink)}
.badge i{width:10px;height:10px;border-radius:50%;background:var(--pink);border:2px solid #101B33}
.photo-frame{justify-self:center;width:min(300px,100%);aspect-ratio:4/5;border:3px solid var(--ink);border-radius:8px;box-shadow:10px 10px 0 var(--hl),20px 20px 0 var(--blue);background:var(--paper);overflow:hidden;transform:rotate(2deg)}
.photo-frame img{width:100%;height:100%;object-fit:cover;display:block}
.photo-empty{width:100%;height:100%;display:grid;place-items:center;font:800 4.5rem 'Bricolage Grotesque',sans-serif;color:var(--mut)}
.hero-text>*{animation:rise .7s cubic-bezier(.2,.7,.2,1) backwards}
.hero-text>*:nth-child(2){animation-delay:.08s} .hero-text>*:nth-child(3){animation-delay:.16s} .hero-text>*:nth-child(4){animation-delay:.24s}
.photo-frame{animation:pop .8s .2s cubic-bezier(.2,.8,.2,1.1) backwards}
@keyframes rise{from{opacity:0;transform:translateY(24px)}}
@keyframes pop{from{opacity:0;transform:rotate(-9deg) scale(.86)}}

.ticker{overflow:hidden;background:var(--ink);color:var(--bg);border-top:3px solid var(--ink);border-bottom:3px solid var(--ink);padding:13px 0}
.ticker-track{display:flex;width:max-content;animation:tick 32s linear infinite}
.ticker-track span{font:800 1.15rem 'Bricolage Grotesque',sans-serif;white-space:nowrap;padding-right:34px;display:inline-flex;align-items:center;gap:34px}
.ticker-track span::after{content:"";width:12px;height:12px;background:var(--hl);transform:rotate(45deg);flex:none}
@keyframes tick{to{transform:translateX(-50%)}}

.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;max-width:1080px;margin:0 auto;padding:56px 24px 8px}
.stat{padding:30px 12px 26px;text-align:center;border:3px solid var(--ink);border-radius:14px;box-shadow:7px 7px 0 var(--ink);transition:transform .2s,box-shadow .2s}
.stat:hover{transform:translate(-4px,-4px);box-shadow:11px 11px 0 var(--ink)}
.stat:nth-child(1){background:var(--hl);color:#18233B}
.stat:nth-child(2){background:var(--blue);color:#fff}
.stat:nth-child(3){background:var(--pink);color:#18233B}
.stat .num{display:inline-block;font-size:clamp(2.4rem,9vw,5.2rem);font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.stat .lbl{margin-top:6px;font-weight:700}

main{max-width:1080px;margin:0 auto;padding:0 24px}
.sec{padding:72px 0 8px;scroll-margin-top:60px}
.sec.rv{opacity:0;transform:translateY(30px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.2,1)}
.sec.rv.in{opacity:1;transform:none}
.sec.two{display:grid;grid-template-columns:1fr 1fr;gap:48px}
.sec h2{display:inline-block;font-size:clamp(1.9rem,4.4vw,2.8rem);font-weight:800;letter-spacing:-.025em;margin-bottom:22px;background:linear-gradient(transparent 80%,var(--hl) 80%,var(--hl) 95%,transparent 95%);padding:0 4px;margin-left:-4px}
.prose{max-width:60ch;margin:0;font-size:1.08rem}
.edu{display:flex;flex-direction:column;margin-bottom:16px;padding-left:14px;border-left:5px solid var(--pink)}
.edu span,.edu small{color:var(--mut)}
.rules{list-style:none;margin:0;padding:0}
.rules li{padding:13px 8px;border-top:2px solid var(--line);transition:background .2s,padding .2s} .rules li:last-child{border-bottom:2px solid var(--line)}
.rules li:hover{background:color-mix(in srgb,var(--hl) 28%,transparent);padding-left:16px}
.verify{display:inline-flex;align-items:center;gap:4px;margin-left:12px;color:var(--blue);font-weight:700;font-size:.9rem}

.donut-wrap{display:flex;gap:48px;align-items:center;flex-wrap:wrap}
.donut{width:min(320px,100%);flex:none} .donut-big{font:800 34px 'Bricolage Grotesque',sans-serif;fill:var(--ink)} .donut-small{font:600 12px Figtree,sans-serif;fill:var(--mut)}
.legend{list-style:none;margin:0;padding:0;flex:1;min-width:240px;max-width:420px}
.legend li{display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:2px solid var(--line);border-radius:8px;transition:background .15s,transform .15s;font-weight:500}
.legend li.on{background:var(--paper);transform:translateX(6px);border-bottom-color:var(--ink)} .legend i{width:16px;height:16px;border-radius:5px;flex:none;border:2px solid var(--ink)} .legend span{flex:1} .legend b{font-variant-numeric:tabular-nums}

.proj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px}
.proj{--c:var(--hl);background:var(--paper);border:3px solid var(--ink);border-top:14px solid var(--c);border-radius:10px;padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:6px 6px 0 var(--ink);transition:transform .2s,box-shadow .2s}
.proj:nth-child(3n+2){--c:var(--blue)} .proj:nth-child(3n){--c:var(--pink)}
.proj:hover{transform:translate(-4px,-4px) rotate(-.6deg);box-shadow:11px 11px 0 var(--ink)}
.proj h3{font-size:1.4rem;font-weight:800} .proj p{margin:0;color:var(--mut);flex:1}

.live{margin:0 0 26px} .live figcaption{font-weight:600;margin-bottom:10px;color:var(--mut)} .live figcaption a{color:var(--blue)}
.live img{max-width:100%;height:auto;background:var(--paper);border:3px solid var(--ink);border-radius:10px;padding:12px;box-shadow:6px 6px 0 var(--hl)}
.posts{display:flex;flex-direction:column}
.post{border-top:2px solid var(--line)} .post:last-child{border-bottom:2px solid var(--line)}
.post button{width:100%;display:flex;justify-content:space-between;gap:16px;align-items:baseline;background:none;border:0;padding:15px 8px;color:var(--ink);font:700 1.08rem Figtree,sans-serif;cursor:pointer;text-align:left;transition:background .2s}
.post button:hover{background:color-mix(in srgb,var(--hl) 28%,transparent)}
.post button small{color:var(--mut);font-weight:400} .post p{margin:0 8px 16px;max-width:64ch;color:var(--mut);white-space:pre-wrap}
.contact-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.contact-list li{display:flex;gap:12px;align-items:center;font-weight:500} .contact-list a{text-underline-offset:3px}
.foot{display:flex;justify-content:space-between;align-items:center;max-width:1080px;margin:80px auto 0;padding:22px 24px;border-top:3px solid var(--ink);color:var(--mut);font-size:.9rem}

.fld{display:flex;flex-direction:column;gap:5px;font-size:.88rem;font-weight:600;color:var(--mut)}
.fld input,.fld textarea{font:400 1rem Figtree,sans-serif;padding:10px 12px;border:2px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);width:100%}
.fld input[type=range]{padding:0;accent-color:var(--blue)}
.fld input:focus,.fld textarea:focus{outline:none;border-color:var(--blue);box-shadow:3px 3px 0 var(--blue)}

.modal{position:fixed;inset:0;z-index:50;background:rgba(8,12,22,.66);display:grid;place-items:center;padding:16px}
.modal-box{width:min(920px,100%);height:min(86vh,900px);display:flex;flex-direction:column;background:var(--paper);border-radius:12px;overflow:hidden;border:3px solid var(--ink);box-shadow:10px 10px 0 var(--hl)}
.modal-bar{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:2px solid var(--ink);gap:10px}
.pdf-frame{flex:1;width:100%;border:0;background:#fff} .pad{padding:24px}

.admin,.login{max-width:820px;margin:0 auto;padding:28px 20px 60px}
.login{max-width:420px;display:flex;flex-direction:column;gap:16px;padding-top:80px}
.login h1,.admin-top h1{font-size:2.2rem;font-weight:800}
.admin-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.tabs{display:flex;gap:6px;overflow-x:auto;border-bottom:3px solid var(--ink);margin-bottom:22px}
.tabs button{padding:10px 14px;border:0;background:none;color:var(--mut);font:700 .95rem Figtree,sans-serif;cursor:pointer;white-space:nowrap;border-radius:8px 8px 0 0}
.tabs button.on{background:var(--blue);color:#fff}
.panel{background:var(--paper);border:3px solid var(--ink);border-radius:12px;padding:22px;box-shadow:6px 6px 0 var(--line)}
.panel h2{font-size:1.45rem;font-weight:800;margin-bottom:8px} .panel p{margin:0 0 14px}
.boxes{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:8px 0 18px}
.box{aspect-ratio:1;border:3px solid var(--ink);border-radius:12px;background:var(--bg);color:var(--mut);font:800 1.25rem 'Bricolage Grotesque',sans-serif;cursor:pointer;display:grid;place-items:center;transition:background .15s,transform .15s,box-shadow .15s;box-shadow:3px 3px 0 var(--ink)}
.box:hover{transform:translate(-2px,-2px);box-shadow:5px 5px 0 var(--ink)}
.box.on{background:var(--hl);color:#101B33;transform:translate(2px,2px);box-shadow:0 0 0 var(--ink)}
.counter{display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:380px}
.counter output{font:800 3.6rem 'Bricolage Grotesque',sans-serif;font-variant-numeric:tabular-nums}
.step{width:64px;height:64px;border-radius:14px;border:3px solid var(--ink);background:var(--ink);color:var(--bg);cursor:pointer;display:grid;place-items:center;box-shadow:4px 4px 0 var(--hl);transition:transform .12s,box-shadow .12s}
.step:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--hl)}
.step:active{transform:translate(3px,3px);box-shadow:0 0 0 var(--hl)}
.ed-item{position:relative;display:flex;flex-direction:column;gap:10px;padding:16px 52px 16px 16px;border:2px solid var(--line);border-radius:10px;background:var(--bg)}
.ed-item>.icon-btn{position:absolute;top:10px;right:10px}
.pdf-pick{display:flex;align-items:center;gap:12px;flex-wrap:wrap} .ok{display:inline-flex;align-items:center;gap:4px;color:#12805C;font-weight:700;font-size:.88rem}
.pf.dark .ok{color:#4CC38A} .err{color:var(--danger);font-weight:600;font-size:.9rem}

@media (max-width:760px){
  .hero{grid-template-columns:1fr;padding-top:44px;padding-bottom:56px;gap:32px} .photo-frame{justify-self:start;width:210px;margin-bottom:20px}
  .hero::before{width:240px;height:240px;right:-90px;top:-90px} .hero::after{display:none}
  .sec.two{grid-template-columns:1fr;gap:12px} .sec{padding-top:52px}
  .nav{padding:8px 14px;gap:10px} .nav .brand::before{display:none}
  .stats{gap:10px;padding:40px 14px 4px} .stat{padding:18px 4px 14px;box-shadow:4px 4px 0 var(--ink);border-width:2px} .stat .lbl{font-size:.78rem}
  .donut-wrap{gap:24px}
}
/* ===== v3: availability, gallery, bio details, 4 stats, phone admin ===== */
.stats{grid-template-columns:repeat(4,1fr);gap:18px}
.stat:nth-child(4){background:var(--mint);color:#18233B}
.stat .num{font-size:clamp(2.2rem,6.5vw,4.6rem)}
.pf.dark .stat:nth-child(1),.pf.dark .stat:nth-child(3),.pf.dark .stat:nth-child(4){color:#F3F2F4}

.ping-wrap{position:relative;flex:none}
.ping{display:inline-flex;align-items:center;gap:9px;height:38px;padding:0 14px 0 12px;border-radius:99px;border:2px solid var(--ink);background:var(--paper);color:var(--ink);font:700 .88rem Figtree,sans-serif;cursor:pointer;transition:background .15s}
.ping:hover{background:var(--hl);color:#101B33}
.pdot{position:relative;display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--st);flex:none}
.pdot::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--st);animation:pingring 1.8s cubic-bezier(0,0,.2,1) infinite}
@keyframes pingring{75%,100%{transform:scale(2.7);opacity:0}}
.ping-pop{position:absolute;right:0;top:calc(100% + 10px);z-index:30;width:min(280px,calc(100vw - 28px));padding:14px 16px;background:var(--paper);border:3px solid var(--ink);border-radius:12px;box-shadow:6px 6px 0 var(--hl);display:flex;flex-direction:column;gap:4px;font-size:.92rem}
.ping-pop strong{display:flex;align-items:center;gap:10px;font:800 1.15rem 'Bricolage Grotesque',sans-serif}
.ping-note{margin-top:6px;padding:8px 10px;background:var(--bg);border-radius:8px;border:2px solid var(--line)}
.chips{display:flex;flex-wrap:wrap;gap:10px}
.status-chip{display:inline-flex;align-items:center;gap:10px;margin:0;padding:7px 16px;border:2px solid var(--ink);border-radius:99px;background:var(--paper);font-weight:700;font-size:.9rem;box-shadow:3px 3px 0 var(--st)}

.details{display:grid;grid-template-columns:auto 1fr;gap:8px 20px;margin:22px 0 0;max-width:60ch}
.details dt{font-weight:700;color:var(--mut)} .details dd{margin:0;font-weight:500}

.gallery{columns:3 240px;column-gap:18px}
.shot{break-inside:avoid;margin:0 0 18px}
.shot button{display:block;width:100%;padding:0;border:3px solid var(--ink);border-radius:10px;background:var(--paper);overflow:hidden;cursor:zoom-in;box-shadow:5px 5px 0 var(--ink);transition:transform .2s,box-shadow .2s}
.shot button:hover{transform:translate(-3px,-3px);box-shadow:9px 9px 0 var(--ink)}
.shot img{display:block;width:100%;height:auto}
.shot figcaption{margin-top:8px;font-size:.9rem;color:var(--mut);font-weight:500}
.lightbox{position:relative;margin:0;max-width:min(1000px,100%);display:flex;flex-direction:column;align-items:center;gap:10px}
.lightbox img{max-width:100%;max-height:78vh;display:block;border:3px solid var(--ink);border-radius:10px;background:var(--paper)}
.lightbox figcaption{color:#fff;font-weight:600;text-align:center}
.lb-close{position:absolute;top:-14px;right:-6px;z-index:2;background:var(--hl);color:#101B33}

.status-panel{margin-bottom:22px}
.status-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.status-head h2{margin:0}
.chip{display:inline-flex;align-items:center;gap:10px;margin:0!important;padding:6px 14px;border:2px solid var(--ink);border-radius:99px;background:var(--bg);font-size:.9rem}
.modes{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.mode{display:flex;align-items:center;gap:12px;min-height:64px;padding:10px 14px;text-align:left;border:3px solid var(--ink);border-radius:12px;background:var(--bg);color:var(--ink);cursor:pointer;font-family:Figtree,sans-serif;box-shadow:3px 3px 0 var(--ink);transition:transform .12s,box-shadow .12s,background .12s}
.mode span{display:flex;flex-direction:column;line-height:1.25} .mode small{color:var(--mut);font-size:.8rem}
.mode .pdot::after{display:none}
.mode.on{background:var(--hl);color:#101B33;transform:translate(2px,2px);box-shadow:0 0 0 var(--ink)} .mode.on small{color:#3b4660}
.when{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.savebadge{font-size:.85rem;font-weight:600;color:var(--mut);display:inline-flex;gap:8px;align-items:center}
.savebadge.ok{color:#12805C} .pf.dark .savebadge.ok{color:#4CC38A} .savebadge.err{color:var(--danger)}
.banner{padding:12px 14px;margin:0 0 18px;border:3px solid var(--ink);border-radius:12px;background:var(--hl);color:#101B33;font-weight:600}
.admin-top .row{flex-wrap:wrap;justify-content:flex-end}
.gal-item{flex-direction:row;align-items:flex-start;gap:14px}
.gal-item>img{width:92px;height:92px;object-fit:cover;border-radius:8px;border:2px solid var(--ink);flex:none;background:var(--paper)}
.gal-item .stack{flex:1;min-width:0}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}

@media (max-width:760px){
  .stats{grid-template-columns:repeat(2,1fr)}
  .stat .num{font-size:clamp(2.4rem,12vw,3.6rem)}
  .nav .brand{max-width:36vw;overflow:hidden;text-overflow:ellipsis}
  .ping{padding:0 12px} .ping-label{display:none}
  .modes{gap:8px} .mode{min-height:72px;padding:10px}
  .when{grid-template-columns:1fr}
  .btn,.tabs button{min-height:44px} .btn.sm{min-height:40px}
  .icon-btn{width:42px;height:42px}
  .gallery{columns:2 140px;column-gap:12px}
  .gal-item{flex-direction:column}
  .gal-item>img{width:100%;height:170px}
  .details{grid-template-columns:1fr;gap:2px} .details dd{margin-bottom:10px}
  .admin{padding:18px 14px 80px}
}
/* ===== v4: intro scene (grid removed) ===== */
.hero{display:block;max-width:none;margin:0;min-height:620px;padding:96px max(24px,calc((100vw - 1080px)/2)) 90px;overflow:hidden}
.hero::before,.hero::after{display:none}
.hero-text{position:relative;z-index:1}
.hero-text{max-width:620px}
.hero-text>*:nth-child(5){animation-delay:.32s}
.hero.space{--bg:#08090C;--paper:#13151A;--ink:#E8E9ED;--mut:#A7A9B0;--line:#292B31;--blue:#766BC2;--hl:#7560B0;--pink:#B76555;--mint:#3A8979;--danger:#D97878;background:radial-gradient(100% 100% at 74% 48%,#17181D 0%,#090A0D 56%,#030407 100%);color:var(--ink)}
.scene{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0}
.avatar{width:120px;height:120px;border-radius:50%;border:3px solid var(--ink);box-shadow:6px 6px 0 var(--hl);overflow:hidden;background:var(--paper);display:grid;place-items:center;margin-bottom:22px;font:800 2.4rem 'Bricolage Grotesque',sans-serif;color:var(--mut)}
.avatar img{width:100%;height:100%;object-fit:cover;display:block}
@media (max-width:760px){
  .hero{padding:44px 20px 360px;min-height:0}
  .avatar{width:96px;height:96px;margin-bottom:18px}
}

@media (prefers-reduced-motion:reduce){
  .pf *{transition:none!important;animation:none!important}
  .sec.rv{opacity:1;transform:none}
}

/* Admin dashboard polish */
.admin{max-width:1040px;padding:36px 24px 80px}
.admin-top{align-items:center;gap:18px;padding:22px 24px;margin:0 0 24px;background:var(--paper);border:2px solid var(--ink);border-radius:18px;box-shadow:7px 7px 0 var(--blue)}
.admin-heading{min-width:0}
.admin-eyebrow{margin:0 0 6px!important;color:var(--blue);font-size:.72rem;font-weight:800;letter-spacing:.14em}
.admin-top h1{font-size:clamp(1.8rem,4vw,2.45rem)}
.admin-subtitle{margin:6px 0 0!important;color:var(--mut);font-size:.94rem}
.admin-top>.row{gap:10px;align-items:center}
.savebadge{padding:7px 11px;border:1px solid var(--line);border-radius:999px;background:var(--bg);white-space:nowrap}
.savebadge::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}
.savebadge.ok{background:color-mix(in srgb,var(--mint) 16%,var(--paper));color:#167A68}
.pf.dark .savebadge.ok{color:#67DFC7}
.savebadge.err{background:color-mix(in srgb,var(--danger) 10%,var(--paper))}
.status-panel{padding:24px;margin-bottom:24px;border-radius:16px;box-shadow:6px 6px 0 color-mix(in srgb,var(--mint) 52%,var(--line))}
.status-head{margin-bottom:18px}
.status-head h2,.panel h2{letter-spacing:-.02em}
.tabs{position:sticky;top:58px;z-index:15;gap:8px;padding:8px;margin:0 0 24px;overflow-x:auto;border:2px solid var(--line);border-radius:14px;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(12px);scrollbar-width:thin}
.tabs button{padding:10px 15px;border:1px solid transparent;border-radius:9px;transition:background .16s,color .16s,transform .16s;min-height:44px}
.tabs button:hover{background:var(--paper);color:var(--ink);transform:translateY(-1px)}
.tabs button.on{background:var(--blue);color:#fff;box-shadow:3px 3px 0 var(--ink)}
.panel{padding:24px;border:2px solid var(--line);border-radius:16px;box-shadow:5px 5px 0 color-mix(in srgb,var(--blue) 22%,var(--line));transition:transform .18s,box-shadow .18s}
.panel h2{font-size:1.55rem;margin-bottom:9px}
.panel>p.mut{max-width:72ch;line-height:1.55}
.ed-item{border-color:var(--line);border-radius:13px;padding:18px 58px 18px 18px;transition:border-color .16s,background .16s}
.ed-item:focus-within{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 4%,var(--bg))}
.fld{gap:7px;color:var(--ink);font-size:.9rem}
.fld input,.fld textarea{min-height:46px;border:1.5px solid var(--line);border-radius:10px;padding:11px 13px;transition:border-color .15s,box-shadow .15s,background .15s}
.fld textarea{min-height:104px;resize:vertical}
.fld input[type=range]{min-height:28px}
.fld input:focus,.fld textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 18%,transparent)}
.box{border-radius:14px;background:var(--paper);box-shadow:3px 3px 0 var(--ink)}
.box.on{background:var(--mint);color:#14263A}
.mode{border-width:2px;border-radius:13px;box-shadow:3px 3px 0 color-mix(in srgb,var(--ink) 82%,transparent)}
.mode.on{background:color-mix(in srgb,var(--blue) 14%,var(--paper));color:var(--ink);box-shadow:inset 0 0 0 1px var(--blue),3px 3px 0 var(--blue)}
.mode.on small{color:var(--mut)}
.step{background:var(--blue);color:#fff;box-shadow:4px 4px 0 var(--ink)}
.step:hover{box-shadow:6px 6px 0 var(--ink)}
.banner{border-width:2px;border-radius:12px;box-shadow:4px 4px 0 var(--ink)}
.admin>.link-btn{margin-top:28px;padding:10px 0;color:var(--mut)}
.admin>.link-btn:hover{color:var(--danger)}
@media(max-width:760px){
  .admin{padding:18px 14px 60px}
  .admin-top{align-items:flex-start;padding:18px;flex-direction:column;box-shadow:5px 5px 0 var(--blue)}
  .admin-top>.row{width:100%;justify-content:space-between;gap:8px}
  .admin-top>.row .btn{padding:9px 11px}
  .tabs{top:0;margin-right:-14px;margin-left:-14px;padding:7px;border-left:0;border-right:0;border-radius:0}
  .tabs button{padding:9px 12px}
  .panel,.status-panel{padding:18px}
  .ed-item{padding:16px 52px 16px 14px}
  .savebadge{font-size:.78rem;padding:6px 8px}
}


/* Quiet visual finish: retain every section and interaction, reduce decorative weight. */
:root{--blue:#766BC2;--hl:#7560B0;--pink:#B76555;--mint:#3A8979}
.hero.space{background:radial-gradient(85% 100% at 72% 48%,#17181b 0%,#0c0d10 52%,#08090b 100%)}
.avatar{border-width:2px;box-shadow:0 10px 28px rgba(0,0,0,.3)}
.btn,.tabs button,.icon-btn,.mode,.box,.step,.banner,.admin-top,.status-panel,.panel,.ed-item,.fld input,.fld textarea,.gal-item,.project-card,.card{box-shadow:none}
.btn,.tabs button,.icon-btn,.mode,.box,.step,.banner,.admin-top,.status-panel,.panel,.ed-item,.fld input,.fld textarea,.gal-item,.project-card,.card{border-width:1px;border-radius:12px}
.btn{transition:transform .18s,border-color .18s,background .18s}
.btn:hover,.project-card:hover,.gal-item:hover,.card:hover,.ed-item:hover{transform:translateY(-2px)}
.admin-top{padding:20px 22px;border-color:var(--line);background:var(--paper)}
.status-panel,.panel{box-shadow:0 8px 24px rgba(0,0,0,.08)}
.tabs{border-width:1px;border-radius:12px}
.tabs button.on{box-shadow:none}
.ed-item{padding:17px 56px 17px 17px}
.box{background:color-mix(in srgb,var(--paper) 78%,var(--bg))}
.box.on{background:var(--mint);color:#fff}
.mode.on{box-shadow:inset 0 0 0 1px var(--blue)}
.step:hover{box-shadow:none}
.banner{box-shadow:none}
@media(max-width:760px){.admin-top{box-shadow:none}}

/* Phone-first fit: preserve every section while avoiding clipped controls/content. */
@media(max-width:760px){
  .pf{font-size:16px;overflow-x:hidden}
  .nav{gap:6px;padding:8px 10px;min-height:58px}
  .nav .brand{flex:0 1 auto;min-width:0;max-width:29vw;font-size:1rem}
  .nav nav{flex:1 1 0;min-width:0;gap:2px;overscroll-behavior-x:contain}
  .nav nav a{padding:7px 9px;font-size:.82rem}
  .ping{min-height:44px;height:44px;padding-inline:10px}
  .icon-btn{width:44px;height:44px}
  .hero{padding:40px 18px clamp(250px,88vw,360px);min-height:0}
  .hero-text{width:100%;max-width:100%}
  .hero h1{font-size:clamp(2.35rem,11.5vw,4.2rem);line-height:1.02;overflow-wrap:anywhere}
  .tagline{max-width:38ch;font-size:clamp(1.05rem,4.8vw,1.25rem)}
  .hero-text .row,.chips{align-items:flex-start}
  .badge{max-width:100%;white-space:normal;line-height:1.35}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding-inline:14px}
  .stat{min-width:0;overflow-wrap:anywhere}
  main{width:100%;padding-inline:clamp(16px,5vw,24px)}
  .sec{min-width:0;scroll-margin-top:68px}
  .sec.two{grid-template-columns:minmax(0,1fr);gap:24px}
  .donut-wrap{width:100%;min-width:0;gap:18px}
  .donut{width:min(100%,320px);max-width:100%}
  .legend{width:100%;min-width:0;max-width:none;flex:0 0 100%}
  .proj-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:16px}
  .proj{min-width:0;padding:18px}
  .proj p,.prose,.post p,.details dd,.contact-list,.live figcaption{overflow-wrap:anywhere;word-break:normal}
  .gallery{columns:2 130px;column-gap:12px}
  .shot{min-width:0}
  .shot img,.live img,.lightbox img{max-width:100%;height:auto}
  .foot{gap:12px;flex-wrap:wrap;margin-top:56px;padding:20px 16px}
  .admin,.login{width:100%;min-width:0;padding-inline:14px}
  .admin-top,.panel,.status-panel{min-width:0}
  .panel{padding:18px}
  .admin-top>.row{flex-wrap:wrap;justify-content:flex-start}
  .admin-top>.row .btn{min-height:44px}
  .tabs{max-width:100%;overscroll-behavior-x:contain}
  .tabs button,.btn,.mode,.step,.ping,.icon-btn{touch-action:manipulation}
  .fld input,.fld textarea,.fld select{font-size:16px;max-width:100%}
  .box{min-width:0;min-height:44px}
  .mode{min-width:0;overflow-wrap:anywhere}
  .when{grid-template-columns:minmax(0,1fr)}
  .modal{padding:10px}
  .modal-box{width:100%;height:min(88dvh,900px)}
}
@media(max-width:420px){
  .nav{gap:5px;padding-inline:8px}
  .nav .brand{max-width:25vw;font-size:.92rem}
  .nav nav a{padding-inline:7px;font-size:.78rem}
  .nav .icon-btn{width:42px;height:42px}
  .ping{width:42px;justify-content:center;padding:0}
  .ping .pdot{margin:0}
  .hero{padding-inline:16px;padding-bottom:270px}
  .hero h1{font-size:clamp(2.15rem,11vw,2.9rem)}
  .stats{gap:8px;padding-inline:12px}
  .stat{padding:15px 7px 13px}
  .stat .lbl{font-size:.76rem;line-height:1.25}
  .gallery{columns:1}
  .modes{grid-template-columns:minmax(0,1fr);}
  .boxes{grid-template-columns:repeat(5,minmax(40px,1fr));gap:6px}
  .ed-item{padding-right:48px}
}
@media(max-width:350px){
  .nav .brand{max-width:22vw;font-size:.86rem}
  .nav nav a{padding-inline:6px;font-size:.74rem}
  .nav{gap:4px}
  .hero h1{font-size:2.1rem}
  .hero{padding-inline:14px}
  .stats{padding-inline:10px}
}
@media(max-height:520px) and (orientation:landscape) and (max-width:900px){
  .hero{padding-top:32px;padding-bottom:220px}
  .avatar{width:72px;height:72px;margin-bottom:12px}
  .nav{position:relative}
}

/* One-time DR reveal: outline trace, chrome polish, then a zoom through the mark. */
.dr-intro{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;overflow:hidden;background:#030406;color:#e9edf4;isolation:isolate;animation:drIntroExit .6s cubic-bezier(.7,0,.84,0) 3.8s forwards}
.dr-intro-glow{position:absolute;inset:0;z-index:0;background:radial-gradient(ellipse at 50% 45%,rgba(144,159,178,.18),transparent 48%),linear-gradient(180deg,#080a0d,#020304 76%);pointer-events:none}
.dr-intro-art-wrap{position:relative;z-index:1;width:min(100vw,1500px);max-height:80vh;display:grid;place-items:center;animation:drMarkZoom 1.2s cubic-bezier(.65,0,.9,.35) 2.85s both}
.dr-intro-mark{display:block;width:100%;height:auto;max-height:80vh;overflow:visible}
.dr-mark-chrome{opacity:0;animation:drSilverResolve .75s cubic-bezier(.2,.75,.25,1) 1.52s forwards}
.dr-mark-traces path{stroke-dasharray:6000;stroke-dashoffset:6000;filter:drop-shadow(0 0 6px rgba(220,232,255,.8));animation:drTraceDraw 1.42s cubic-bezier(.55,0,.25,1) forwards}
.dr-mark-traces .dr-trace-d{animation-delay:.12s}.dr-mark-traces .dr-trace-r{animation-delay:.36s}
.dr-mark-polish{opacity:0;transform:translateX(-95%);animation:drPolishSweep 1.05s cubic-bezier(.2,.7,.15,1) 1.88s both}
.dr-intro-caption{position:absolute;z-index:2;bottom:max(7vh,30px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:11px;color:#aeb8c6;font:600 .7rem/1 system-ui,sans-serif;letter-spacing:.28em;white-space:nowrap;opacity:0;animation:drCaption .7s ease-out 1.75s forwards,drCaptionOut .35s ease-in 2.9s forwards}
.dr-intro-caption span{color:#f2f4f8;font-weight:800;letter-spacing:.18em}.dr-intro-caption i{display:block;width:28px;height:1px;background:#738195}
.dr-intro-skip{position:absolute;z-index:3;right:max(24px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));min-height:44px;padding:0 14px;border:1px solid rgba(221,230,242,.32);border-radius:999px;background:rgba(14,17,22,.78);color:#e9edf4;font:600 .84rem system-ui,sans-serif;cursor:pointer;transition:background .18s,border-color .18s}
.dr-intro-skip:hover{background:#1b2028;border-color:rgba(221,230,242,.7)}.dr-intro-skip span{padding-left:5px;color:#aeb8c6}
@keyframes drTraceDraw{to{stroke-dashoffset:0}}
@keyframes drSilverResolve{0%{opacity:0;filter:brightness(.55) saturate(.35)}55%{opacity:1;filter:brightness(1.35) saturate(.5)}100%{opacity:1;filter:brightness(1) saturate(.25)}}
@keyframes drPolishSweep{0%{opacity:0;transform:translateX(-95%)}12%{opacity:1}82%{opacity:.88}100%{opacity:0;transform:translateX(95%)}}
@keyframes drMarkZoom{0%{transform:scale(1);opacity:1;filter:brightness(1)}35%{opacity:1;filter:brightness(1.4)}100%{transform:scale(4.8);opacity:0;filter:brightness(1.8)}}
@keyframes drCaption{to{opacity:1;transform:translate(-50%,-3px)}}
@keyframes drCaptionOut{to{opacity:0;transform:translate(-50%,-10px)}}
@keyframes drIntroExit{to{opacity:0;visibility:hidden;pointer-events:none}}
@media(max-width:600px){.dr-intro-art-wrap{width:min(100vw,1500px)}.dr-intro-caption{bottom:max(12vh,72px);font-size:.62rem}.dr-intro-skip{right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom))}}
@media(prefers-reduced-motion:reduce){.dr-intro,.dr-intro-art-wrap,.dr-mark-chrome,.dr-mark-traces path,.dr-mark-polish,.dr-intro-caption{animation:none!important}.dr-intro{opacity:0;visibility:hidden;pointer-events:none}}

`;
