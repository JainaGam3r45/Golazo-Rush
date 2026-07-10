# Golazo game-server (Phase B0+)

Isolated Node HTTP + WebSocket service for online matches. Hosts:

1. **WS transport** — join / ping / inputs / authoritative snapshots
2. **Room HTTP fallback** — mirrors `private-room` edge actions via InsForge RPCs
3. **Match host** — `@golazo-rush/game-sim` (5v5, 1 human/side, bots fill)

Provider-neutral: same container can run on Railway, Fly, or InsForge Compute later. Client config key: **`PUBLIC_GAME_SERVER_URL`**.

## What it does

| Surface | Path | Purpose |
|---------|------|---------|
| Health | `GET /health` | Liveness / room counts |
| Room API | `POST /room` (alias `/api/room`) | Mirrors `private-room` actions via InsForge RPCs |
| WebSocket | `ws(s)://<host>/` | Join / ping / probe+match input / snapshots |

No Colyseus. Dependencies: `ws` + `@insforge/sdk` (server-only). Sim loaded from `packages/game-sim` via relative import.

## Protocol (WebSocket)

Client → server:

```json
{ "t": "join", "roomId": "...", "token": "..." }
{ "t": "ping", "clientTime": 123 }
{ "t": "probeInput", "seq": 1, "x": 0.5, "y": -1 }
{ "t": "matchInput", "seq": 1, "x": 0.5, "y": -1, "buttons": { "sprint": false, "shoot": false } }
{ "t": "matchJoin", "side": "home", "homeTeamId": "...", "awayTeamId": "...", "durationSeconds": 180 }
```

Server → client:

```json
{ "t": "joined", "roomId": "...", "connectionId": "..." }
{ "t": "pong", "clientTime": 123, "serverTime": 456 }
{ "t": "peerJoined" }
{ "t": "probeState", "seq": 1, "clients": 2 }
{ "t": "peerLeft" }
{ "t": "matchJoined", "roomId": "...", "side": "home" }
{ "t": "matchSnapshot", "tick": 1, "phase": "playing", "score": { "home": 0, "away": 0 }, "ball": {...}, "players": [...], "stub": false }
{ "t": "finished", "homeScore": 1, "awayScore": 0, "score": { "home": 1, "away": 0 } }
{ "t": "error", "code": "...", "message": "..." }
```

Rules: max 2 connections per `roomId`, JSON only, message size limit, messages/sec rate limit, heartbeat closes idle sockets, empty rooms deleted, never trust client `userId`, never log full tokens.

### Client flow

1. Lobby countdown ends → `golazo:online-match-start`
2. Client opens `PUBLIC_GAME_SERVER_URL` as WSS, sends `join` with Bearer/access token
3. On `joined`, client sends `matchJoin` with `side` (+ optional team ids for persistence)
4. When both sides joined, server starts game-sim and streams `matchSnapshot` (~15 Hz)
5. Client sends `probeInput` / `matchInput`; server applies to that human only

## Auth

| Mode | When | Behavior |
|------|------|----------|
| `WS_AUTH_MODE=test` | Local only | `WS_TEST_TOKEN` **or** `test:<userId>` for distinct humans |
| `WS_AUTH_MODE=insforge` | Default / production | `createClient({ accessToken }).auth.getCurrentUser()` |

Production **rejects** `WS_AUTH_MODE=test`.

**Client token gap:** SPA `@insforge/sdk` may not expose `getAccessToken()`. Use `injectOnlineAccessToken()` / cookie / `/dev/ws-probe` until SDK provides a stable getter. Locally use `WS_AUTH_MODE=test` with `test:home` / `test:away`.

Room HTTP API always validates Bearer via InsForge `getCurrentUser`, then calls SECURITY DEFINER RPCs with `createAdminClient` + `INSFORGE_API_KEY` (never expose to browser).

## Match + persistence

- Sim: `packages/game-sim` `createMatch` — 10 players (2 GK + 8 outfield), bots fill non-human slots
- Tick ~20 Hz, snapshots ~15 Hz (env: `MATCH_TICK_HZ`, `MATCH_SNAPSHOT_HZ`)
- On `finished`, server persists via admin insert into `matches` / rankings / `live_events` when `INSFORGE_API_KEY` + team ids are present
- Scores come from the sim only — never from the client

## Environment

| Variable | Required | Notes |
|----------|----------|-------|
| `PORT` | Prod yes | Platform injects; local default `8787` |
| `ALLOWED_ORIGINS` | Prod yes | Comma-separated; no `*` |
| `PUBLIC_APP_ORIGIN` | Prod yes | Canonical app origin |
| `INSFORGE_BASE_URL` | Auth / room / persist | e.g. `https://b963cy5n.us-east.insforge.app` |
| `INSFORGE_API_KEY` | Room API + persist | Server-only admin key |
| `WS_AUTH_MODE` | | `test` \| `insforge` (default `insforge`) |
| `WS_TEST_TOKEN` | test mode | Local probe token |
| `LOG_LEVEL` | | `error` \| `warn` \| `info` \| `debug` |
| `NODE_ENV` | | `production` enables strict checks |

Client (Astro / Vercel):

| Variable | Notes |
|----------|-------|
| `PUBLIC_GAME_SERVER_URL` | e.g. `https://golazo-game.up.railway.app` — HTTP base; WS is same host with `wss:` |

### Room API client fallback

If `insforge.functions.invoke('private-room')` stays blocked (502 / deploy iterator errors), point the lobby client at:

`POST ${PUBLIC_GAME_SERVER_URL}/room`

Same JSON body as the edge function (`action`, `teamId`, …) and `Authorization: Bearer <accessToken>`. Response shapes match `private-room`.

## Local run

```bash
cd services/game-server
npm install
# PowerShell
$env:WS_AUTH_MODE="test"
$env:WS_TEST_TOKEN="golazo-local-test-token"
$env:PORT="8787"
npm start
```

```bash
curl http://127.0.0.1:8787/health
npm test
npm run smoke:stability
```

Health URL (local): `http://127.0.0.1:8787/health`  
Diagnostic page (not in SiteNav): `/dev/ws-probe`

Two-client local tokens: `test:home-user` and `test:away-user`.

## Docker / Railway

Build from **repo root** (needs `packages/game-sim` in context):

```bash
docker build -f services/game-server/Dockerfile -t golazo-game-server .
```

Railway: set health check `/health`, inject env vars above, **stop if billing is required**. Set `PUBLIC_GAME_SERVER_URL` on the Astro app to the public HTTPS URL.

```bash
# from repo root after linking Railway project
railway up --dockerfile services/game-server/Dockerfile
```

## Relation to `tools/compute-probe`

Superseded. New work lives here.
