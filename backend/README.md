# Backend

Minimal Go backend with token-based authentication. Zero external dependencies (stdlib only).

## Files

- `main.go` - The server
- `users.txt` - User credentials (format: `username:password`, one per line)
- `secret.txt` - Secret key for signing tokens
- `data.txt` - The file that gets served/appended to

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/data` | No | Returns contents of data.txt |
| POST | `/login` | No | Returns auth token |
| POST/PUT | `/data` | Yes | Appends body to data.txt |

## Setup

1. Edit `users.txt` to set your username:password
2. Edit `secret.txt` with a random string for token signing
3. Build and run:

```bash
go build -o server .
./server
```

Server runs on port 8900 by default. Set `PORT` env var to change.

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
- `users.txt` and `secret.txt` are gitignored (sensitive)
