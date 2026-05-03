# Million Checkboxes

A real-time collaborative app where users can toggle any of 1,000,000 checkboxes and see changes from other users instantly — inspired by the viral "One Million Checkboxes" concept.

## Project Overview

Authenticated users interact with a shared grid of one million checkboxes. Every toggle is broadcast in real-time to all connected clients via WebSocket. State is stored efficiently using Redis Bitmap (1 bit per checkbox = ~125KB for 1M checkboxes). The app uses a custom OIDC provider for authentication and implements custom rate limiting without third-party packages.

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| Node.js + Express | HTTP server and REST API |
| Socket.IO | Real-time bidirectional communication |
| Redis (Valkey) | State storage (Bitmap), rate limiting, online tracking, Pub/Sub |
| OIDC (Custom Auth Server) | OAuth 2.0 Authorization Code flow |
| HTML/CSS/JS | Frontend with dark theme UI |
| Docker/Podman | Containerized Redis |

## Features Implemented

- **1 Million Checkboxes** with paginated UI (1,000 per page)
- **Real-time sync** — toggle a checkbox and all users see it instantly
- **Redis Bitmap** — `SETBIT`/`GETBIT` for O(1) per-checkbox operations, 125KB total storage
- **Custom sliding window rate limiting** — no third-party rate limit packages
- **Online user count** — tracked via Redis Set (`SADD`/`SREM`/`SCARD`)
- **Uncheck All** button — resets entire bitmap in one operation
- **Checked count** — uses `BITCOUNT` for real-time tally
- **Cross-server sync** via Redis Pub/Sub
- **Input validation** — index range (0–999,999), type checks
- **Disconnect handling** — removes user from online set on disconnect
- **HTTP rate limiting** on REST endpoints with `Retry-After` header
- **OIDC authentication** — only logged-in users can access the app

## How to Run Locally

### Prerequisites

- Node.js v18+
- Docker or Podman Desktop
- OIDC Auth Server running (see `oidc-auth-main/` folder)

### 1. Start the OIDC Auth Server

```bash
cd oidc-auth-main
pnpm install
# Start PostgreSQL
podman compose up -d
# Run migrations
npx drizzle-kit push
# Start auth server
pnpm run dev
```

Auth server runs on `http://localhost:8000`.

### 2. Register this app with the Auth Server

```bash
curl -X POST http://localhost:8000/admin/register \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Million Checkboxes",
    "applicationUrl": "http://localhost:3000",
    "redirectUri": "http://localhost:3000/auth/callback"
  }'
```

Save the returned `clientId` and `clientSecret`.

### 3. Start Redis

```bash
cd million-checkboxes
podman compose up -d
```

This starts Valkey/Redis on port 6379.

### 4. Configure Environment

```bash
cp .env.example .env
```

Fill in `CLIENT_ID` and `CLIENT_SECRET` from step 2.

### 5. Install Dependencies & Start

```bash
npm install
npm run dev
```

App runs on `http://localhost:3000`.

## Environment Variables Required

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `APP_URL` | Public URL of this app | `http://localhost:3000` |
| `AUTH_SERVER` | OIDC auth server URL | `http://localhost:8000` |
| `CLIENT_ID` | OAuth client ID (from registration) | `9ff154fd...` |
| `CLIENT_SECRET` | OAuth client secret (from registration) | `b93a09bb...` |
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `DATABASE_URL` | Database url for Postgresql DB| `postgresql://admin:admin@localhost:5432/oidc_auth` |
| `DB_PORT` | DB port | `8000` |

## Redis Setup Instructions

The project includes a `docker-compose.yml` that runs Valkey (Redis-compatible):

```bash
podman compose up -d   # or: docker compose up -d
```

This starts:
- **Valkey** on port `6379` with persistent volume `valkey-data`

Redis is used for:
| Key | Type | Purpose |
|-----|------|---------|
| `checkbox-state` | Bitmap | 1 bit per checkbox (1M bits = 125KB) |
| `rate-limit:*` | String (counter) | Sliding window rate limit counters with TTL |
| `online-users` | Set | Track unique online user IDs |
| `internal-server:checkbox:change` | Pub/Sub channel | Cross-server broadcast |

To inspect state:
```bash
# Check how many boxes are checked
redis-cli BITCOUNT checkbox-state

# Check online users
redis-cli SCARD online-users
```

## Auth Flow Explanation

```
User visits http://localhost:3000
        ↓
    Not authenticated → Redirect to /login.html
        ↓
    Clicks "Sign in with OIDC"
        ↓
    Redirect to AUTH_SERVER/o/authorize?client_id=...&redirect_uri=...&state=...
        ↓
    User logs in or signs up on auth server
        ↓
    Auth server redirects to /auth/callback?code=...&state=...
        ↓
    Server validates state, exchanges code for tokens via POST /o/token
        ↓
    access_token + id_token stored as httpOnly cookies
        ↓
    Redirect to / (protected page)
        ↓
    Socket.IO connects, middleware reads access_token from cookie header
```

- **State parameter** prevents CSRF attacks
- **httpOnly cookies** prevent XSS token theft
- **Server-to-server token exchange** keeps client_secret secure

## WebSocket Flow Explanation

### Connection
1. Client loads page → Socket.IO connects
2. Middleware extracts `access_token` from cookie header
3. JWT payload decoded, expiry checked
4. `socket.user` set with user claims
5. User added to Redis `online-users` set
6. Online count broadcast to all clients

### Checkbox Toggle
```
Client: checkbox change event
    ↓
socket.on('client:checkbox:change', { index, checked })
    ↓
Validate: index is 0–999,999, checked is boolean
    ↓
Rate limit check: 10 operations per 30 seconds per user
    ↓ (if allowed)
redis.setbit('checkbox-state', index, checked ? 1 : 0)
    ↓
publisher.publish('internal-server:checkbox:change', JSON.stringify({ index, checked }))
    ↓
Subscriber receives → io.emit('server:checkbox:change', { index, checked })
    ↓
All clients update checkbox in DOM
```

### Events

| Direction | Event | Payload |
|-----------|-------|---------|
| Client → Server | `client:checkbox:change` | `{ index: number, checked: boolean }` |
| Client → Server | `client:uncheck-all` | _(none)_ |
| Server → Client | `server:checkbox:change` | `{ index: number, checked: boolean }` |
| Server → Client | `server:uncheck-all` | _(none)_ |
| Server → Client | `server:online-count` | `number` |
| Server → Client | `server:error` | `{ error: string }` |

### Disconnect
- User removed from `online-users` Redis Set
- Updated online count broadcast to all clients

## Rate Limiting Logic Explanation

Custom implementation using Redis — no third-party rate limiting packages.

### Algorithm: Sliding Window Counter

```
1. On each request, INCR a Redis key: rate-limit:{type}:{userId}
2. If counter === 1 (first in window), set EXPIRE to windowSec
3. If counter > maxRequests, reject with retryAfter = TTL of key
4. Otherwise, allow and return remaining = maxRequests - current
```

### Two Rate Limiters

| Type | Target | Limit | Window |
|------|--------|-------|--------|
| WebSocket | `client:checkbox:change` | 10 ops | 30 seconds |
| HTTP | `GET /checkboxes` | 30 requests | 60 seconds |

### HTTP Rate Limit Headers

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 27
Retry-After: 45          ← only on 429 response
```

When rate limited, WebSocket receives:
```json
{ "error": "Too many changes. Try again in 15s." }
```

Displayed as a toast notification on the frontend.

## Screenshots or Demo Link

> https://youtu.be/H6zCnsd1-AE?si=n6-1Gz1xpl7Mycwg
