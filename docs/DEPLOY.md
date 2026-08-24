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
4. `railway domain` mints the `*.up.railway.app` URL. The purchased domain is
   **potatoesunite.com** (registered on Railway, Railway-managed DNS, renews 2027-07-24);
   `railway domain potatoesunite.com --service net` attached it and Railway synced the CNAME and
   certificate itself within a minute. Set `GITHUB_URL` when the repo goes public.

### `TRUST_PROXY=1` — set this before the door opens

**On Railway this is not optional.** The device endpoints (`/v0/register`, `/v0/heartbeat`,
`/v0/choice`) and the File-claim routes are rate-limited per client address. Railway terminates TLS at
its edge, so `req.socket.remoteAddress` is the *edge's* address and is the same for every visitor on
earth. Left unset, the first busy minute puts the whole internet — the owner's own potatoes included —
behind one shared quota.

```
railway variables --service net --set "TRUST_PROXY=1"
```

`TRUST_PROXY` is the number of proxies in front of the server that are ours. `0` (the default, and what
a LAN Net or `npm start` on a laptop gets) ignores `x-forwarded-for` completely, so nothing a stranger
types can pass for an address. `1` reads the address the last trusted hop saw; anything a client
prepends sits to the left of that and is discarded, so the header cannot be forged into a fresh quota.
Put another proxy in front (Cloudflare ahead of Railway) and the number goes up to match.

The server says which mode it is in on the second line of its startup log:

```
addresses: x-forwarded-for, 1 trusted hop(s)
addresses: the socket (TRUST_PROXY unset — correct on a LAN, wrong behind a proxy)
```

### Loosening a limit without a deploy

Every limit is an env var in `max/windowSeconds` form; `off` removes one entirely. Defaults are in
`server/lib/app.js` (`LIMITS`), with the reasoning for each number beside it.

| Variable | Default | What it rations |
|---|---|---|
| `RATE_HEARTBEAT` | `240/60` | heartbeats per address — six potatoes handled non-stop for a minute |
| `RATE_CHOICE` | `60/60` | votes per address |
| `RATE_REGISTER` | `10/3600` | **new** citizens per address; re-registering a known secret is free |
| `RATE_REGISTER_NET` | `60/3600` | new citizens across the whole Net, the backstop against a fleet |
| `RATE_CLAIM` | `10/60` | claim-code attempts per address |

A refused device gets `429` with a `Retry-After`, which both firmwares treat as an ordinary failed call:
events are held, the identity is kept. If a real potato ever trips one, loosen the variable — that is a
bug in the number, not a device misbehaving.

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
