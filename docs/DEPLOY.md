# Putting the Net on the internet

The Net is one Node process with a SQLite file. It needs an always-on box, a persistent disk, and TLS. It does NOT fit serverless hosts (Vercel, Netlify functions): no persistent process, no disk.

## Railway (chosen 23 Aug — domain, DNS and TLS all in one dashboard; deployed 23 Aug)

The server reads `../docs` (story, illustrations) and `../assets` at runtime, so **the deploy
context is the repo root**, not `server/`. The root `package.json` + `railway.json` exist exactly
for this, and `.railwayignore` keeps `site/`, `firmware/` and the rest out of the upload. A deploy
from `server/` boots and looks healthy, but `/about` loses its story and every illustration 404s.

1. `railway login` (`--browserless` prints a pairing link for the human).
2. From the **repo root**: `railway init --name potatoes-unite`, then
   `railway add --service net --variables "DB_PATH=/data/potatoes.db" --variables "TUBER_URL=https://x.com/IssuedByCouncil"`,
   then `railway volume add -m /data`. Railway injects `PORT`; the server honors it.
3. `railway up --detach --service net` — again from the repo root.
4. `railway domain` mints the `*.up.railway.app` URL. Attach the purchased domain in the
   dashboard: service → Settings → Domains. Set `GITHUB_URL` when the repo goes public.

CLI footguns, learned the hard way (23 Aug):
- The project link is **per-directory**. `railway up` from an unlinked directory silently creates
  a brand-new project instead of failing. Link the repo root before deploying.
- `railway delete --project <name>` matches names **case-insensitively**, and `--yes` skips the
  only confirmation — aimed at a stray duplicate, it deleted the real project. Delete projects in
  the dashboard only, never from a script.
- `railway list` lags deletions by minutes. Verify a project exists by linking to its **ID**, not
  by its presence in the list.

**Cutover note:** the desk potatoes keep talking to the LAN server until firmware 0.3.0 (HTTPS) ships. Launching the public site early is fine, but it starts as its own empty Net; the real move is: ship 0.3.0 → copy `potatoes.db` to the volume → repoint the devices. Doreen and Rosemary travel with the file.

## Fly.io (alternative; config also in the repo)
```
cd server
fly launch --no-deploy        # accepts server/fly.toml; pick an app name
fly volumes create potato_data --size 1
fly secrets set GITHUB_URL=https://github.com/OWNER/REPO TUBER_URL=https://x.com/thetuberpress
fly deploy
```
Point the domain (CNAME) at the app; `fly certs add potatoesunite.net`.

## Railway / Render
Deploy the `server/` folder as a Node service; attach a volume; set `DB_PATH` to it; set `PORT` from the platform's env; add the two URL envs.

## A $5 VPS
`node server.js` under systemd behind Caddy (`caddy reverse-proxy --from potatoesunite.net --to :8080` gives TLS in one line). Back up the DB file.

## Before the devices point at it
- Firmware 0.3.0 with HTTPS (in plan) — until then devices only talk to a LAN server.
- Bake the public URL into the flasher build (`DEFAULT_SERVER_URL`).
- Optimize the six illustration PNGs (they total ~4 MB now; `pngquant` before public).
- Back up `potatoes.db` daily (it is the civilization).
