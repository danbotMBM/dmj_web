# Backend

Minimal Go backend with token-based authentication.

## Files

- `main.go` - The server
- `users.txt` - User credentials (format: `username:bcrypt_hash`, one per line)
- `secret.txt` - Secret key for signing tokens (auto-generated if missing)
- `data.txt` - The file that gets served/appended to
- `hashpw/` - Helper to generate a bcrypt hash for `users.txt`

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/data` | No | Returns contents of data.txt |
| POST | `/login` | No | Returns auth token |
| POST/PUT | `/data` | Yes | Appends body to data.txt |
| GET/POST | `/mcp` | No | MCP server (Streamable HTTP), read-only — see below |

(Plus the trivia, holdem, photos, running, scores, and analytics routes registered
in their respective files.)

## MCP server (`/mcp`)

`mcp.go` exposes a read-only [Model Context Protocol](https://modelcontextprotocol.io)
server over Streamable HTTP so AI assistants (e.g. a Claude custom connector) can
search and read the site's public content. It serves data that is already public
on the website; there are no mutating tools and nothing here touches the private
trivia answers, analytics, users, or secret files.

Tools:

- `search_content(query, section?)` — full-text search over blogs/pages/projects
- `get_page(url)` — full plaintext of a page
- `list_projects(category?)` — the curated project catalog
- `list_photos(location?)` — photo gallery metadata
- `get_training_status()` — half-marathon training calendar + recent runs
- `get_race_result(name?)` — a runner's finish + race summary

Content comes from `../_site/content-index.json`, built by Eleventy
(`generators/content-index.11ty.js`) on every `npx @11ty/eleventy` run and
hot-reloaded when its mtime changes. Connect from Claude via Settings →
Connectors → Add custom connector → `https://api.danbotlab.com/mcp` (no auth).
Locally, inspect with `npx @modelcontextprotocol/inspector` pointed at
`http://localhost:8900/mcp`.

## Setup

1. Add a user to `users.txt` as `username:bcrypt_hash`. Generate the hash:

   ```bash
   go run ./hashpw 'your-password'
   # -> admin:$2a$10$....   (paste this line into users.txt)
   ```

   Plaintext passwords are rejected — only bcrypt hashes (`$2...`) are accepted.

2. `secret.txt` is created automatically with a strong random key on first run.
   Do not ship a known/placeholder value.

3. Build and run:

   ```bash
   go build -o server .
   ./server
   ```

Server runs on port 8900 by default. Set `PORT` env var to change.

### Environment overrides

- `PORT` - listen port (default `8900`)
- `CORS_ORIGIN` - allowed CORS origin (set per environment)
- `SECRET_FILE` - path to the signing secret (default `secret.txt`; point it
  outside the web root in production)
- `USERS_FILE` - path to the credentials file (default `users.txt`; point it
  outside the web root in production)
- `DISCORD_WEBHOOK_FILE` - path to the Discord webhook URL file
- `CONTENT_INDEX` - path to the MCP content index (default `../_site/content-index.json`)
- `RACE_RESULTS_FILE` - path to race results JSON (default `../blogs/race_results/race_results_all.json`)
- `RACE_RUNNER_NAME` - default runner for `get_race_result` (default `Daniel Jones`)
- `STRAVA_RUNS_FILE` - path to Strava runs JSON (default `cronjobs/strava_runs.json`)

## Usage Examples

Login (get token):
```bash
curl -X POST http://localhost:8900/login \
  -d '{"username":"admin","password":"changeme"}'
```

Read data (public):
```bash
curl http://localhost:8900/data
```

Append data (authenticated):
```bash
curl -X POST http://localhost:8900/data \
  -H "Authorization: Bearer <token>" \
  -d "new content here"
```

## Notes

- Tokens expire after 24 hours
- Passwords are stored as bcrypt hashes; verification is constant-time
- `/login` is rate limited per client IP (5 failures in 15 min → 15 min lockout)
- `users.txt` and `secret.txt` are gitignored (sensitive) and must never be
  served by the web server (see the `location ~ ^/backend` deny rule in `nginx.conf`)
