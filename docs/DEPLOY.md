# Putting the Net on the internet

The Net is one Node process with a SQLite file. It needs an always-on box, a persistent disk, and TLS. It does NOT fit serverless hosts (Vercel, Netlify functions): no persistent process, no disk.

## Railway (chosen 23 Aug — domain, DNS and TLS all in one dashboard)

1. Push this repo to GitHub (private is fine) or use `railway up` from `server/`.
2. New project → deploy from the repo; set the service **Root Directory** to `server/` (`server/railway.json` supplies the start command and the `/health` healthcheck).
3. Attach a **Volume**, mount it at `/data`, and set the env var `DB_PATH=/data/potatoes.db`. Railway injects `PORT`; the server honors it.
4. Set `GITHUB_URL` and `TUBER_URL` env vars when ready.
5. Buy the domain in Railway → service → Settings → Domains; it handles DNS and the certificate.

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
