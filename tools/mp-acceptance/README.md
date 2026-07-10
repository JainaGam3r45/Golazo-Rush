# Multiplayer WS acceptance

Black-box checks against `services/game-server` (health, ROOM_FULL, auth, origin, ping/pong, room isolation, disconnect cleanup).

Does **not** import game-server source. Spawns `node src/index.js` under `services/game-server`, or connects to an existing URL.

## Prerequisites

```bash
npm --prefix services/game-server install
```

Uses the `ws` package from `services/game-server/node_modules` (fallback: `tools/compute-probe/node_modules`).

## Commands

From the repo root:

```bash
# node:test suite (always starts a temporary local server)
pnpm test:mp

# CLI harness (starts local server unless a URL is set)
pnpm mp:acceptance
```

### Against a running server

```bash
# PowerShell
$env:GAME_SERVER_URL = "http://127.0.0.1:8787"
$env:WS_TEST_TOKEN = "mp-acceptance-token"   # must match server WS_TEST_TOKEN
$env:MP_ORIGIN = "http://localhost:4321"     # must be on ALLOWED_ORIGINS
pnpm mp:acceptance
```

Also accepted: `PUBLIC_GAME_SERVER_URL` or `MP_ACCEPTANCE_URL`.

Default local spawn env:

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `development` |
| `WS_AUTH_MODE` | `test` |
| `WS_TEST_TOKEN` | `mp-acceptance-token` |
| `ALLOWED_ORIGINS` / `PUBLIC_APP_ORIGIN` | `http://localhost:4321` |
| `INSFORGE_BASE_URL` | `https://b963cy5n.us-east.insforge.app` |
| `LOG_LEVEL` | `error` |
| `PORT` | free ephemeral port |

## Scenarios

1. `GET /health` → 200, `ok`, `golazo-game-server`
2. Two clients join same room → mutual `peerJoined` + `probeState` echo
3. Third client in same room → `ROOM_FULL`
4. Bad token → `UNAUTHORIZED`
5. Bad Origin → HTTP 403 on upgrade
6. `ping` → `pong`
7. `probeInput` in room A not visible in room B
8. Disconnect empties room (`/health` `rooms` count + re-join succeeds)

Exit code `0` on full pass, `1` on any failure.

## Related docs

Compute inventory (stuck services, proposed removes): [`../compute-services-inventory.md`](../compute-services-inventory.md).