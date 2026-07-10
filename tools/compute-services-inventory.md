# InsForge Compute services inventory

**Project:** Golazo-Rush (`298feacd-4df4-4889-85ac-dd95957fddbf`)  
**Region / appkey:** `us-east` / `b963cy5n`  
**Listed:** 2026-07-10 (post healthy game-server deploy) via `npx @insforge/cli compute list --json`  
**Quota:** platform enforces ~1 active service in practice. One service in use: `golazo-match`.

## Cleanup (earlier 2026-07-10)

Orphaned probes were already deleted in a prior pass. Re-check this iteration:

| Check | Result |
|-------|--------|
| `compute list --json` before deploy | `[]` |
| Deletes this iteration | **Skipped** (list already empty; nothing to delete) |

## Services (current)

| Name | ID | Status | Endpoint | flyMachineId | Notes |
|------|----|--------|----------|--------------|-------|
| `golazo-match` | `dd61e9dd-110c-4e79-87f9-24a85e47e1c0` | `running` | `https://golazo-match-298feacd-4df4-4889-85ac-dd95957fddbf.fly.dev` | `d892455c3e06d8` | Authoritative `services/game-server` (source-mode deploy) |

**WSS URL:** `wss://golazo-match-298feacd-4df4-4889-85ac-dd95957fddbf.fly.dev`

## Fresh Compute deploy (this iteration)

| Field | Value |
|-------|-------|
| Name | `golazo-match` |
| Source | Repo root build context + temporary root `Dockerfile` copied from `services/game-server/Dockerfile` (InsForge source mode requires `Dockerfile` in the deploy dir; authoritative file remains under `services/game-server/`) |
| Port / CPU / memory / region | `8080` / `shared-1x` / `512` / `iad` |
| flyctl | WinGet path: `...\Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe\flyctl.exe` on `PATH` |
| Image | `registry.fly.io/golazo-match-298feacd-4df4-4889-85ac-dd95957fddbf@sha256:971a4c08d11a55a42e04a40dbd11a2153b902c9feee96747f7d3c2b781886914` |
| Deploy result | **Success** — `status: running`, non-null `flyMachineId` |

### Production env (set via `--env-file` on deploy; never committed)

| Variable | Value / notes |
|----------|----------------|
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `ALLOWED_ORIGINS` | `https://golazo-rush-nine.vercel.app` |
| `PUBLIC_APP_ORIGIN` | `https://golazo-rush-nine.vercel.app` |
| `INSFORGE_BASE_URL` | `https://b963cy5n.us-east.insforge.app` |
| `WS_AUTH_MODE` | `insforge` (code default; required for prod) |
| `LOG_LEVEL` | `info` |
| `INSFORGE_API_KEY` | project API key via InsForge compute env (server-only) |

## Verification (2026-07-10)

| Check | Result |
|-------|--------|
| `compute list` / `compute get` | `running`, `flyMachineId` present |
| `GET /health` | **200** `{"ok":true,"service":"golazo-game-server","authMode":"insforge"}` (first call may cold-start ~30s+; subsequent ~2s) |
| TLS | Valid `*.fly.dev` Let's Encrypt cert |
| WSS upgrade | **OK** with `Origin: https://golazo-rush-nine.vercel.app` |
| Join + `ping`/`pong` | **OK** (InsForge access tokens) |
| Two clients same room | **OK** (`connections: 2`) |
| Disconnect cleanup | **OK** (`rooms: 0`, `connections: 0` within ~5s) |

**Production multiplayer:** Compute + frontend WSS URL wired. Full two-auth-user match not verified in this pass.

## Frontend / Vercel (done 2026-07-10)

| Step | Result |
|------|--------|
| Production env `PUBLIC_GAME_SERVER_URL` | Set to `wss://golazo-match-298feacd-4df4-4889-85ac-dd95957fddbf.fly.dev` |
| Redeploy | `dpl_3E9j8SBDrDs99nycPwMYcbJMacx3` → aliased `https://golazo-rush-nine.vercel.app` |
| Bundle check | `getPublicGameServerUrl()` inlined to that WSS URL in `/_astro/onlineProtocol.*.js` |

Do **not** point `PUBLIC_GAME_SERVER_URL` at HTTPS; use the `wss://` URL above.

## Edge functions

Finite retries already exhausted historically (`Event iterator validation failed`). Not re-attempted. Private-room lobby uses authenticated DB RPCs (`*_auth` via `insforge.database.rpc`). Game-server `POST /room` remains an optional fallback when InsForge is not configured.

## Architecture notes

- **InsForge-only.** No Railway / Fly / Render account deploys. Compute runs on InsForge-managed Fly under the hood; manage only via `npx @insforge/cli compute …`.
- Do **not** call `flyctl` directly against personal Fly credentials.
- Source redeploy: ensure `flyctl` on `PATH`, copy `services/game-server/Dockerfile` → repo-root `Dockerfile` for the CLI context (or add a committed root Dockerfile later), then:
  ```bash
  npx @insforge/cli compute deploy . --name golazo-match --port 8080 --env-file <secrets.env> --json
  ```
- Local WS acceptance (no cloud): `pnpm test:mp` / `pnpm mp:acceptance`.
- Full QA report: `tools/mp-acceptance/QA-REPORT.md`.

## Prior probe history (archived)

Earlier probes (`golazo-probe`, `golazo-probe2`, `golazo-probe3`, `golazo-probe-img`, `golazo-probe-final`) were deleted 2026-07-10 when quota-blocked / unhealthy. See git history of this file for delete UUIDs.
