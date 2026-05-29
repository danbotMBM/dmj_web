# Security Audit — dmj_web

_Date: 2026-05-29 · Scope: entire repository (Go backend, static frontend, nginx, deploy, utils)_

This is a point-in-time review of possible security risks across the site. Findings
are ordered by severity. Each item lists where it lives, why it matters, and a
recommended fix. Nothing here was changed in code — this document is the deliverable.

---

## Critical

### C1. Deploy copies backend secrets & game answers into the public web root
- **Where:** `deploy.sh` (the `rsync` block, lines ~70–81) + `nginx.conf` (the
  `danielmarkjones.com` server, `root /opt/dmj_web/`).
- **What:** The production deploy runs `rsync -av --delete "$SRC_DIR/" "$DEST_DIR/"`
  where `DEST_DIR=/opt/dmj_web` **is the nginx static root**. The exclude list omits
  `.git`, `deploy.sh`, `README.md`, `running.json`, and the analytics DB — but does
  **not** exclude the sensitive backend files:
  - `backend/users.txt` — plaintext `username:password` credentials
  - `backend/secret.txt` — the HMAC token-signing key
  - `backend/discord_webhook.txt` — the Discord webhook URL
  - `backend/trivia_questions.json` — **all trivia answers** (`answer.valid`)
- **Impact:** If reachable, `https://danielmarkjones.com/backend/secret.txt` leaks the
  signing key → an attacker can **forge valid auth tokens** for every admin endpoint.
  `/backend/users.txt` leaks credentials directly. `/backend/trivia_questions.json`
  leaks all answers, defeating the trivia game. The `.go` source files are also exposed.
- **Current partial mitigation:** `deploy.sh` runs `chmod -R 770 "$DEST_DIR/backend"`,
  so if the nginx worker runs as a *different* user than `danbot` it will get `403`
  on `/backend/*`. This is fragile — it depends on the nginx worker user, survives only
  until someone changes perms/adds autoindex, and the secrets still physically sit in
  the web root.
- **Fix (defense in depth, do all three):**
  1. Never place secrets under the web root. Keep `users.txt`/`secret.txt`/
     `discord_webhook.txt` outside `/opt/dmj_web` (e.g. `/etc/dmj_web/`) and point the
     service at them via env vars / `WorkingDirectory`.
  2. Add explicit `rsync` excludes for `backend/users.txt`, `backend/secret.txt`,
     `backend/discord_webhook.txt`, `backend/*.go`, `backend/*_test.go`, and
     `backend/trivia_questions.json` (answers should be served only by the API).
  3. Add an nginx guard on both static servers:
     ```nginx
     location ~ /(backend|\.git|\.) { deny all; return 404; }
     ```

### C2. Default, hard-coded HMAC signing secret
- **Where:** `backend/main.go` → `loadSecret()` (lines 76–86).
- **What:** If `secret.txt` is missing, the server silently writes and uses
  `"change-me-to-something-random"` as the token-signing key.
- **Impact:** A predictable signing key lets anyone forge tokens
  (`username:expiry:HMAC`) and pass every `validateToken` check — full access to all
  admin/auth endpoints (`/data` POST, `/photos` PUT, `/running` PUT, `/trivia/admin/*`,
  `/trivia/stats*`, `/holdem/admin/timeline`).
- **Fix:** Fail closed instead of inventing a default. Generate a random 32-byte secret
  with `crypto/rand` on first run (or refuse to start and log an error). Never ship a
  known constant fallback.

---

## High

### H1. Passwords stored and compared in plaintext
- **Where:** `backend/main.go` → `checkCredentials()` (lines 201–227), `users.txt` format.
- **What:** Credentials are kept as `username:password` plaintext and compared with
  `parts[1] == password` (also a non-constant-time comparison → minor timing leak).
- **Impact:** Any read of `users.txt` (see C1, backups, logs) discloses usable
  passwords. No hashing means no protection at rest.
- **Fix:** Store a per-user salted hash (bcrypt/argon2id) and verify with the library’s
  constant-time compare. Migrate `users.txt` to `username:bcrypt_hash`.

### H2. No rate limiting / lockout on `/login`
- **Where:** `backend/main.go` → `handleLogin()`; nginx has no `limit_req`.
- **What:** Unlimited password attempts against a small plaintext credential set.
- **Impact:** Online brute force is trivial, especially combined with H1 (weak/short
  passwords).
- **Fix:** Add nginx `limit_req` on `/login`, and/or per-IP/per-user backoff and lockout
  in the handler. Consider logging failed attempts.

### H3. Real production domain served with a self-signed certificate
- **Where:** `nginx.conf` — the `api.danielmarkjones.com` and `danielmarkjones.com`
  servers both use `/etc/nginx/ssl/selfsigned.crt`.
- **What:** A public domain is served with a self-signed cert.
- **Impact:** Browsers reject the cert (or train users to click through warnings),
  there’s no real authentication of the server, and it enables trivial MITM. Tokens and
  credentials cross a connection users can’t verify.
- **Fix:** Use a real CA certificate (Let’s Encrypt / certbot) for the public domains.
  Reserve the self-signed cert for the local `danbotlab` dev hosts only.

### H4. Stored XSS in the Hold’em admin timeline via player names
- **Where:** `games/holdem/admin/admin.js` — `showTooltip()` does
  `tooltip.innerHTML = html` (line ~17), and the tooltip HTML interpolates
  `row.name` unescaped (lines ~172–174 and ~189). Player names come from
  `holdemJoin`/`holdemRename`, where `sanitizeName()` (`backend/holdem.go` ~1390) only
  trims and truncates to 16 chars — **no HTML escaping**.
- **What:** An attacker joins the public Hold’em table with a crafted name; the name is
  persisted to `holdem_events` and later rendered as raw HTML in the admin’s tooltip.
- **Impact:** Script executes in the authenticated admin’s browser when they hover the
  timeline. Because the auth token lives in `localStorage` (`dmj-auth-token`), the
  payload can exfiltrate it → full admin compromise. (The 16-char name cap constrains,
  but does not eliminate, exploitability.)
- **Note:** The main game UI (`holdem.js`) correctly uses `escapeHTML(s.name)`; only the
  admin tooltip path is unescaped. Submitted `word` values are dictionary-validated A–Z,
  so they’re safe — names are the sink.
- **Fix:** HTML-escape `row.name` (and any user data) before building tooltip HTML, or
  build the tooltip with `textContent`/DOM nodes. Defense in depth: escape/validate names
  server-side in `sanitizeName`.

---

## Medium

### M1. Unauthenticated IDOR on player stats
- **Where:** `backend/analytics.go` — `handlePlayerStatsUpload` (POST
  `/trivia/player-stats`, no auth) and `handlePlayerStatsGet` (GET
  `/trivia/player-stats/{id}`, no auth).
- **What:** Anyone who knows/guesses a 16-char alphanumeric `player_id` can **read** that
  player’s history and **overwrite** it (`ON CONFLICT ... DO UPDATE`). IDs are generated
  client-side and exposed in requests.
- **Impact:** Tampering with / disclosure of other players’ stored stats. Low data
  sensitivity, but it’s a clear authorization gap and an unauthenticated write primitive.
- **Fix:** Bind stats to an authenticated session, or at minimum require a secret tied to
  the player ID. Add request size limits.

### M2. Public, unauthenticated arbitrary append to `data.txt`
- **Where:** `backend/main.go` — `postData()` (auth-gated) is fine, but note `/data` is
  documented public-read and writeable with any valid token; combined with C2/H1 the
  write path is reachable. Also there is **no body size limit** on any handler
  (`io.ReadAll(r.Body)` in `postData`, `putPhotos`, `putRunning`).
- **Impact:** Memory-exhaustion / disk-fill DoS via large request bodies; unbounded file
  growth on `data.txt`.
- **Fix:** Wrap bodies with `http.MaxBytesReader`, and set
  `Server.ReadTimeout/WriteTimeout/IdleTimeout` (currently uses the default
  `http.ListenAndServe` with no timeouts → Slowloris exposure).

### M3. Client-controlled IP used for analytics/geo
- **Where:** `backend/analytics.go` — `getClientIP()` trusts `X-Real-IP` then
  `X-Forwarded-For` from the request.
- **What:** These headers are set by nginx for proxied traffic, but if the Go port
  (`:8900`) is ever reachable directly, or an upstream forwards client-supplied values,
  the IP can be spoofed.
- **Impact:** Poisoned analytics, spoofed geolocation, attribution evasion. Low direct
  impact (analytics only) but worth hardening.
- **Fix:** Bind the backend to `127.0.0.1` only, and trust forwarded headers from the
  proxy exclusively (or take the last hop). Confirm `:8900`/`:8901` aren’t exposed by a
  firewall.

### M4. Missing HTTP security headers and no HTTP→HTTPS redirect
- **Where:** `nginx.conf` (all four servers listen on `80` and `443` with the same root;
  no redirect, no security headers).
- **What:** Plain HTTP is served alongside HTTPS, and responses lack
  `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options`/`Content-Security-Policy`, and `Referrer-Policy`.
- **Impact:** Downgrade/MITM on port 80; no clickjacking/MIME-sniffing protection; a CSP
  would also blunt the XSS in H4.
- **Fix:** Redirect `80 → 443`, add `HSTS` (after H3 is fixed) and the headers above. A
  reasonable CSP for a mostly-static site is high value.

### M5. CORS allows credentials-bearing methods from a single origin but with `Authorization`
- **Where:** `backend/main.go` — `cors()`.
- **What:** `Access-Control-Allow-Origin` is a single origin (good), but the default when
  `CORS_ORIGIN` is unset is `https://danbotlab`. If the env var is ever missing in prod,
  cross-origin admin calls silently break or, worse, a misconfig could widen it.
- **Impact:** Mostly correctness/robustness; flagged because auth tokens flow through CORS.
- **Fix:** Fail loudly if `CORS_ORIGIN` is unset in production; never fall back to a
  permissive value. (Don’t introduce `*` with `Authorization`.)

---

## Low / Informational

- **L1. Auth token in `localStorage`** (`login/index.html`, `dmj-auth-token`): readable by
  any XSS (see H4). Prefer an `HttpOnly; Secure; SameSite` cookie, or accept the risk and
  prioritize eliminating XSS + adding CSP.
- **L2. Non-crypto RNG for the tile bag** (`backend/holdem.go` `newBag()` uses
  `math/rand`): deck order is predictable to a determined player. Fine for a casual game;
  use `crypto/rand` if fairness ever matters.
- **L3. GeoIP lookups over cleartext HTTP** (`backend/analytics.go`,
  `http://ip-api.com/batch`): player IPs sent unencrypted to a third party. Use HTTPS and
  review the privacy implications of shipping visitor IPs off-box.
- **L4. `.git` exposed on the dev static host** (`nginx.conf`, `danbotlab` root =
  `/home/danbot/dev/dmj_web/` with no dotfile deny): source/history disclosure on the dev
  vhost. Prod excludes `.git` via rsync; add the dotfile `deny` rule from C1 anyway.
- **L5. `validateToken` parsing is brittle** (`backend/main.go` 243–276): it `Split`s on
  `:` and assumes a colon-free username; the `Sscanf` path is effectively dead code. Works
  today, but fragile — parse explicitly (`SplitN`, fixed fields) and reject malformed
  tokens early. Signature check correctly uses `hmac.Equal` (constant-time) — good.
- **L6. Verbose server-side error logging** of webhook responses / DB errors to stderr is
  fine, but ensure logs aren’t world-readable and don’t capture secrets.
- **L7. File permissions in the repo**: several tracked files are `0777`/`0755`
  (`index.html`, `deploy.sh`, `.gitignore`, etc.). Tighten to `0644`/`0755` as
  appropriate.

---

## What looks good

- SQL access in `analytics.go` / `holdem_analytics.go` is **fully parameterized** — no SQL
  injection found.
- Token signatures use `hmac.Equal` for constant-time comparison.
- Discord webhook URL is validated against expected prefixes and the send is sandboxed
  (goroutine + `recover`, 10s timeout, length cap).
- Trivia answer submissions and Hold’em word submissions are server-validated; the main
  game UI escapes player names with `escapeHTML`.
- Secrets are `.gitignore`d (not committed to the repo) — the exposure in C1 is a *deploy*
  issue, not a committed-secret issue.

---

## Suggested priority order

1. **C1** — exclude secrets/source/answers from the web root + nginx `deny` (highest blast radius).
2. **C2** — remove the default signing secret; generate/require a strong key.
3. **H3** — real TLS certificate for the public domains.
4. **H1 / H2** — hash passwords + rate-limit login.
5. **H4** — escape player names in the admin tooltip (and server-side).
6. Medium items (body limits + server timeouts, security headers/redirect, IDOR, IP trust).
