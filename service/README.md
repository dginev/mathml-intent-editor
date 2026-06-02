# MathML Intent Open Editor — OAuth exchange service

A tiny Fastify service whose only job is to hold the secret the browser can't: it finishes GitHub
sign-in by exchanging the OAuth `code` for the user's **access token**. Everything else — fork, commit,
open the PR — the browser does itself, directly against `api.github.com` with that token, so the PR is
genuinely the user's and the commit earns them contribution credit. Deployed on the `latexml.rs` VM
behind Caddy.

Why a server at all: `github.com/login/oauth/access_token` sends no CORS headers and needs the OAuth App
**client secret**, so the code→token exchange can't happen in the browser. `api.github.com` *is*
CORS-enabled, so all the read/write REST calls stay client-side.

## Endpoints
- `POST /auth` `{ code }` → `{ handle, token }` — exchange the OAuth `code` (OAuth App client_id+secret)
  and read the user's `@handle` (`GET /user`). The **user's** access token is returned to the browser.
- `GET /health` → `{ ok: true }`.

Logic split: `handlers.js` (pure, unit-tested with `node --test`), `github.js` (OAuth exchange + the
`GET /user` lookup), `server.js` (Fastify wiring).

## Local
```sh
npm install
npm test                 # node --test (handler logic, no network)
# to run for real, set the env (see .env.example) then:
node --env-file=.env src/server.js
```

## Deploy on latexml.rs (Caddy already runs there; DNS intent-api.latexml.rs is set)

1. **Install Node** (Debian/Ubuntu):
   ```sh
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt-get install -y nodejs
   ```
2. **Code + deps:**
   ```sh
   mkdir -p /opt/mathml-intent/service && rsync -a --exclude node_modules service/ /opt/mathml-intent/service/
   cd /opt/mathml-intent/service && npm install --omit=dev
   # redeploy (code-only): rsync -avz --exclude node_modules --exclude .git service/ root@latexml.rs:/opt/mathml-intent/service/ && ssh root@latexml.rs systemctl restart mathml-intent
   ```
3. **Secret** (root-only) — just the OAuth App client secret now (no bot key, no JWT secret):
   ```sh
   mkdir -p /etc/mathml-intent
   cp service/.env.example /etc/mathml-intent/service.env   # fill GH_CLIENT_ID + GH_CLIENT_SECRET
   chmod 600 /etc/mathml-intent/service.env
   ```
4. **systemd unit** `/etc/systemd/system/mathml-intent.service`:
   ```ini
   [Unit]
   Description=MathML Intent Open Editor service
   After=network.target

   [Service]
   WorkingDirectory=/opt/mathml-intent/service
   EnvironmentFile=/etc/mathml-intent/service.env
   ExecStart=/usr/bin/node src/server.js
   Restart=always
   DynamicUser=yes
   ReadOnlyPaths=/etc/mathml-intent

   [Install]
   WantedBy=multi-user.target
   ```
   ```sh
   systemctl daemon-reload && systemctl enable --now mathml-intent
   ```
5. **Caddy** — add to the Caddyfile and reload (`caddy reload`):
   ```
   intent-api.latexml.rs {
       reverse_proxy 127.0.0.1:8787
   }
   ```
   Caddy auto-provisions the TLS cert. CORS is handled by the service (`ALLOWED_ORIGIN`).
6. **Verify:** `curl https://intent-api.latexml.rs/health` → `{"ok":true}`.

The app points at this via `VITE_GH_SERVICE=https://intent-api.latexml.rs` and `VITE_GH_CLIENT_ID` (the
OAuth App's public client id), plus `VITE_GH_OWNER`/`VITE_GH_REPO`.
