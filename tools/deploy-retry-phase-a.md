# Phase A deploy retry procedure

Finite retries only (max **3 attempts** per target). Do **not** delete InsForge Compute services unless you have confirmed they are orphans (see §4).

Use `npx @insforge/cli` from the repo root. Prefer `--json` for machine-readable status.

## Prerequisites

```bash
npx @insforge/cli current --json
npx @insforge/cli whoami --json
```

Confirm project is **Golazo-Rush**. Ensure edge secrets exist before relying on cleanup:

```bash
npx @insforge/cli secrets list --json
# Required for cleanup-rooms (fail-closed):
# npx @insforge/cli secrets set ROOM_CLEANUP_SECRET "<long-random-value>"
```

Backoff between attempts: **~30s → ~90s → ~180s** (or stop earlier on a clear quota/platform error).

---

## 1. Edge function: `private-room`

### Deploy (attempt 1–3)

```bash
npx @insforge/cli functions deploy private-room --file functions/private-room.ts --json
```

### Verify status

```bash
npx @insforge/cli functions list --json
npx @insforge/cli functions get private-room --json
```

### Verify logs

```bash
npx @insforge/cli logs function.logs --json
# Optional filter / recent window if supported by your CLI version:
npx @insforge/cli logs function-deploy.logs --json
```

### Known failure

If the response contains **`Event iterator validation failed`**, record the attempt number and stop after 3 tries. Do not loop forever. Re-try later when the platform is healthy.

---

## 2. Edge function: `cleanup-rooms`

### Deploy (attempt 1–3)

```bash
npx @insforge/cli functions deploy cleanup-rooms --file functions/cleanup-rooms.ts --json
```

### Verify status

```bash
npx @insforge/cli functions list --json
npx @insforge/cli functions get cleanup-rooms --json
```

### Verify logs

```bash
npx @insforge/cli logs function.logs --json
npx @insforge/cli logs function-deploy.logs --json
```

### Smoke invoke (after `ROOM_CLEANUP_SECRET` is set)

```bash
curl -X POST "https://b963cy5n.us-east.insforge.app/functions/cleanup-rooms" \
  -H "Content-Type: application/json" \
  -H "x-cleanup-secret: $ROOM_CLEANUP_SECRET"
```

Expect `401` without the secret; `200` with `{ "cancelled": <n> }` when authorized.

---

## 3. Compute probe (`tools/compute-probe`)

### Preflight: list + quota

```bash
npx @insforge/cli compute list --json
```

Only deploy if quota / platform allows a new service. If list fails or reports no capacity, **do not** delete existing services — document and stop (or use the Railway/Fly alternative in §5).

`flyctl` (Windows WinGet path, if needed on PATH):

```text
C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe\flyctl.exe
```

### Deploy (attempt 1–3)

```bash
npx @insforge/cli compute deploy ./tools/compute-probe --name golazo-probe --port 8080 --json
```

Optional always-on (only if you intentionally want it):

```bash
npx @insforge/cli compute deploy ./tools/compute-probe --name golazo-probe --port 8080 --always-on --json
```

### Verify status

```bash
npx @insforge/cli compute list --json
npx @insforge/cli compute get golazo-probe --json
```

### Verify logs

```bash
npx @insforge/cli compute logs golazo-probe --json
```

### Post-deploy probe checks (only if deploy succeeded)

Replace `<endpoint>` with the HTTPS host from `compute get`.

1. **Health**

```bash
curl -sS "https://<endpoint>/health"
# expect: {"ok":true,"service":"golazo-compute-probe"}
```

2. **WebSocket ping/pong** (Node one-liner)

```bash
node -e "import('ws').then(({default:W})=>{const s=new W('wss://<endpoint>');s.on('message',d=>console.log(String(d)));s.on('open',()=>s.send(JSON.stringify({t:'ping'})));setTimeout(()=>s.close(),2000);})"
```

3. **Two simultaneous connections** — open two WS clients; both should receive `welcome` and answer `ping` with `pong`.

4. **Close + cleanup** — close both sockets; confirm process stays healthy via `/health` and logs show no crash loop.

Do **not** wire Phaser or Phase B game-sim here.

---

## 4. Orphan confirmation before any Compute delete

Never run `compute delete` / destroy without this checklist:

1. `npx @insforge/cli compute list --json` — note every service name, created time, URL.
2. Confirm the service is **not** referenced by:
   - `PUBLIC_GAME_SERVER_URL` / production env
   - docs, schedules, or other team members
   - a previous successful probe you still need
3. If unsure, **leave it** and ask in the report: “Is `<name>` an orphan?”
4. Only after explicit confirmation: delete with the CLI delete command for that service (and prefer `--json`).

---

## 5. Alternative plan (document only — do not implement here)

If InsForge Compute remains unavailable (quota, `Event iterator validation failed`, or deploy timeouts), host the **same** Node/WebSocket probe from `tools/compute-probe` on Railway or Fly.io.

### Env vars

| Variable | Where | Notes |
|----------|--------|--------|
| `PORT` | Platform | Probe defaults to `8080`; Railway/Fly usually inject `PORT`. |
| `PUBLIC_GAME_SERVER_URL` | Astro / Vercel public env | Client base URL for future game server (e.g. `https://golazo-probe.up.railway.app`). Not required for Phase A lobby. |
| InsForge keys | **Server only later** | Future auth/token validation against InsForge — do not put `INSFORGE_API_KEY` in the browser. |

### Dockerfile

Already present: `tools/compute-probe/Dockerfile` (`node:22-alpine`, `PORT=8080`, `CMD node server.mjs`).

### Health check

- Path: `GET /health`
- Expect JSON `{ "ok": true, "service": "golazo-compute-probe" }`
- Configure platform health check on `/health` (HTTP 200).

### CORS / origins

Current probe has no browser CORS for WS beyond default; HTTP only serves `/health`. For a browser client later:

- Prefer same-site or explicit `Access-Control-Allow-Origin` for the Astro origin(s).
- WebSocket: validate `Origin` on upgrade when auth is added.

### Client interface via `PUBLIC_GAME_SERVER_URL`

- Keep lobby/room logic on InsForge (Phase A).
- When a game server exists, the client reads `import.meta.env.PUBLIC_GAME_SERVER_URL` and opens `wss://…` there — same contract whether the host is InsForge Compute, Railway, or Fly.
- No Phaser wiring in this alternative plan.

### Future InsForge connection

- Validate session JWT / access token on WS connect (edge or game server).
- Map socket → `userId` server-side; never trust client-sent identity.
- Room membership checks can call InsForge admin RPC or a dedicated edge function.

### Fly.io sketch (commands only)

```bash
# from tools/compute-probe
fly apps create golazo-probe
fly deploy --dockerfile Dockerfile
fly status
curl -sS "https://golazo-probe.fly.dev/health"
```

### Railway sketch (commands only)

```bash
# Prefer services/game-server (Phase B0+), not tools/compute-probe
cd services/game-server
railway up --dockerfile Dockerfile
# set health check path /health in dashboard
# set PUBLIC_GAME_SERVER_URL on the Astro/Vercel app
```

Full env + acceptance: `services/game-server/README.md`.

### Room API fallback (when edge functions stay 502)

Client can call `POST ${PUBLIC_GAME_SERVER_URL}/room` with the same body as `private-room` and `Authorization: Bearer <token>`. Implemented in `services/game-server` — do not put `INSFORGE_API_KEY` in the browser.

---

## cleanup-rooms mitigation (2026-07-10)

| Check | Result |
|-------|--------|
| `ROOM_CLEANUP_SECRET` | Created via `npx @insforge/cli secrets add` (was missing) |
| Deployed source (`functions code cleanup-rooms`) | Already fail-closed (requires secret) |
| Schedules | None (`schedules list` → `[]`) |
| Live invoke | **All** edge functions return **502** (`ECONNREFUSED 127.0.0.1:7133`) — runtime down, not fail-open |
| Auth matrix (no/wrong/correct secret) | Could not assert 401/200 while gateway returns 502 |

**Temporarily disable (no delete):** there is no schedule to pause. Until the function runtime recovers, the endpoint is effectively unreachable (502). After runtime is healthy, re-test secret auth; if an old fail-open build ever returns, do **not** delete the function — stop invoking it and re-deploy fail-closed code (max 2–3 attempts). Optional: remove `ROOM_CLEANUP_SECRET` only if you intentionally want the fail-closed build to reject everyone with 401.

Secret value: store out of git (e.g. password manager). Retrieve with `npx @insforge/cli secrets get ROOM_CLEANUP_SECRET` if needed.

---

## Attempt log (2026-07-10)

| Target | Attempt | Result | Notes |
|--------|---------|--------|-------|
| private-room | 1 | failed | Build OK then `Event iterator validation failed` |
| private-room | 2 | failed | Same iterator error; `deployedAt` still older successful deploy |
| cleanup-rooms | 1 | failed | Same iterator error (after fail-closed secret hardening) |
| cleanup-rooms | 2 | failed | Same iterator error |
| private-room | 3 (finite retry 2026-07-10 later) | failed | `Event iterator validation failed`; stop further deploys — use `services/game-server` `POST /room` fallback |
| cleanup-rooms | 3 (finite retry) | failed | Same iterator error; deployed source already fail-closed; runtime also 502 (`localhost:7133`) |
| compute list | — | ok | 5 services: `golazo-probe-final` status `deploying`; others `failed` |
| golazo-probe | 1 | failed | `flyctl is required for source-mode deploy` (PATH) |
| golazo-probe | 2 | failed | With flyctl on PATH: `Service "golazo-probe" exists but has no Fly app yet. Delete it and redeploy.` — **not deleted** (orphan confirmation required) |
| golazo-probe-a | 3 | failed | `COMPUTE_QUOTA_EXCEEDED` — project already at 1 active service (`golazo-probe-final`) |
| golazo-probe-final health | — | failed | TLS handshake failed; status stuck `deploying`, `flyMachineId: null` |

### Orphan candidates (ask before delete)

Do **not** auto-delete. Confirm which of these are safe to remove to free the 1-service quota:

- `golazo-probe` (failed, no Fly app)
- `golazo-probe2` (failed)
- `golazo-probe3` (failed)
- `golazo-probe-img` (failed)
- `golazo-probe-final` (stuck `deploying`, has endpoint URL but health TLS fails)
