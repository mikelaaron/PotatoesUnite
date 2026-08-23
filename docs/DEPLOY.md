# Putting the Net on the internet

The Net is one Node process with a SQLite file. It needs an always-on box, a persistent disk, and TLS. It does NOT fit serverless hosts (Vercel, Netlify functions): no persistent process, no disk.

## Fly.io (recommended: free-tier friendly, TLS, one file already here)
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
