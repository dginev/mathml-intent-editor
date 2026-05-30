# MathML Intent Open Editor — auth + PR service

A small Fastify service that holds the secrets the browser can't: it finishes GitHub sign-in and opens
PRs as our controlled bot (a GitHub App installation). Deployed on the `latexml.rs` VM behind Caddy.

## Endpoints
- `POST /auth` `{ code }` → `{ jwt }` — exchange the OAuth `code` (App client_id+secret), read the
  user's `@handle`, return a signed identity JWT. The user token is discarded.
- `POST /submit` (`Authorization: Bearer <jwt>`, body `{ content, message? }`) → `{ prNumber, prUrl }`
  — verify the JWT, then as the bot commit `content` to `intent/<handle>` and ensure the PR is open.
- `GET /health` → `{ ok: true }`.

Logic split: `handlers.js` (pure, unit-tested with `node --test`), `github.js` (Octokit + App auth),
`session.js` (JWT), `server.js` (Fastify wiring).

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
   mkdir -p /opt/mathml-intent-service && rsync -a service/ /opt/mathml-intent-service/   # or git clone + cd service
   cd /opt/mathml-intent-service && npm install --omit=dev
   ```
3. **Secrets** (root-only):
   ```sh
   mkdir -p /etc/mathml-intent
   cp service/.env.example /etc/mathml-intent/service.env   # fill GH_CLIENT_SECRET + JWT_SECRET
   chmod 600 /etc/mathml-intent/service.env
   # put the App private key (.pem you downloaded) here:
   install -m 600 app-private-key.pem /etc/mathml-intent/app-private-key.pem
   ```
   Generate the JWT secret: `openssl rand -hex 32`.
4. **systemd unit** `/etc/systemd/system/mathml-intent.service`:
   ```ini
   [Unit]
   Description=MathML Intent Open Editor service
   After=network.target

   [Service]
   WorkingDirectory=/opt/mathml-intent-service
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

The app points at this via `VITE_GH_OAUTH_PROXY=https://intent-api.latexml.rs` (and `VITE_GH_CLIENT_ID`,
`VITE_GH_OWNER`, `VITE_GH_REPO`).
