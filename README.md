# Portfolio

React + Express portfolio with a public page and a phone-friendly admin page.
Admin changes are saved on the server, so every visitor sees them.

## Requirements
- Node.js 18 or newer (https://nodejs.org)

## Upgrading an existing copy (keeps your content)
Your content, PDFs, images and password live in `server/data/`.
1. Stop the server (Ctrl + C).
2. Copy everything from this zip over your project folder, **except** do not delete `server/data`.
3. Run `npm install`, then `npm run dev`.

## Run it on your computer
```bash
cp .env.example .env   # Windows PowerShell: Copy-Item .env.example .env
# Edit .env and set ADMIN_PASSWORD before the first start
npm install
npm run dev
```
Open http://localhost:5173

## Admin
- Open http://localhost:5173/#admin, or click **Admin** in the footer.
- The first-start password is `ADMIN_PASSWORD` from your local `.env` file. Keep `.env` private; Git ignores it. If unset, the initial password is `admin123`.
- Forgot it? Stop the server, delete `server/data/admin.json`, and start again. It resets to `ADMIN_PASSWORD` (or `admin123` if unset).

## Using the admin from your phone
- **Same Wi-Fi:** `npm run dev` also prints a Network address like `http://192.168.x.x:5173`. Open `http://192.168.x.x:5173/#admin` on your phone. If it does not load, allow Node.js through Windows Firewall for private networks.
- **From anywhere:** deploy it (see below), then open `https://your-site/#admin` on your phone.

## What the admin can do
- **Availability (top of the page):** Idle now, Busy now, Scheduled idle, Scheduled busy, with an optional note. Times are India time (IST). A scheduled mode applies inside its window and the opposite status outside it. The pulsing dot in the site's top right and the hero badge update on their own.
- **Today:** 10 LeetCode boxes (reset at midnight, solves stay in your total) and the − / + projects counter
- **Project PDFs:** upload, replace or remove a PDF per project
- **Images:** gallery photos with captions and ordering (big phone photos are shrunk automatically)
- **Content:** achievements, certifications, education, skills (donut chart), open source, research papers, blog
- **Profile and contact:** intro background, name, tagline, bio, bio detail lines, photo, resume PDF, GitHub and LeetCode, contact, page title

**Intro background** (Profile and contact tab): Saturn rings (default), Constellation, Galaxy, Warp speed, or Plain. Visitors can move the mouse or drag a finger over it, and click to speed it up. It pauses when scrolled out of view and shows a still frame if the visitor prefers reduced motion. Your photo shows as the round picture above your name.

The stats row shows LeetCode solved, Projects done, Achievements and Research papers.

## Put it online
```bash
npm install
npm run build
npm start          # serves site + API on http://localhost:3001
```
Deploy on any host that runs Node and has a persistent disk (Render, Railway, Fly.io, a VPS).
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment: `ADMIN_PASSWORD` (first start only), `TRUST_PROXY=1` (on Render/Railway/Nginx), `DATA_DIR` (path of the persistent disk)
- Monitor `https://your-site/api/health`

## Security and reliability
- Passwords are hashed with scrypt; 10 wrong attempts lock that visitor out for 15 minutes; sessions last 12 hours; logout ends the session on the server.
- Only a logged-in admin can save anything. Everything saved is checked: allowed names only, PDFs must really be PDFs, images must really be images, size limits apply.
- Security headers and a strict Content-Security-Policy are sent. Use HTTPS in production (hosts give it for free).
- Saves are written safely (a crash cannot corrupt your data). A backup of your content is kept in `server/data/backups/` (latest 30, at most one every 10 minutes).
- The admin shows "All changes saved" or a clear error, retries failed saves, and warns before you close the tab with an unsaved change.
- Back up `server/data/` yourself for PDFs and images, which are not in the automatic backups.
- No site is perfectly secure. Change the default password before sharing the site.

## Notes
- GitHub and LeetCode graphs come from free outside services (ghchart.rshah.org, leetcard.jacoblin.cool) and need your usernames.
- PDFs must be under 3 MB each.

## Structure
```
server/index.js    Express API (login, validated storage, images, serves dist/)
src/Portfolio.jsx  The whole UI (public page + admin)
src/scenes.js      The animated intro backgrounds (Saturn, constellation, galaxy, warp)
src/storage.js     Browser to server calls
```

