# InsForge Compute services inventory

**Project:** Golazo-Rush (`298feacd-4df4-4889-85ac-dd95957fddbf`)  
**Region / appkey:** `us-east` / `b963cy5n`  
**Listed:** 2026-07-10 via `npx @insforge/cli compute list --json`  
**Quota:** platform enforces ~1 active service in practice (`COMPUTE_QUOTA_EXCEEDED` when creating another while `golazo-probe-final` is `deploying`). CLI list has no explicit quota field.

**Do not delete until a human confirms orphans.** Commands below are proposals only — not executed.

## Services

| Name | ID | Status | Endpoint | Quota impact |
|------|----|--------|----------|--------------|
| `golazo-probe-final` | `868a0015-72a5-4aee-a041-957fb7acdf1f` | **deploying** (stuck) | `https://golazo-probe-final-298feacd-4df4-4889-85ac-dd95957fddbf.fly.dev` | Occupies the active slot; health/TLS previously failed; `flyMachineId` was null |
| `golazo-probe` | `7658ccbc-d95f-447b-b9d6-ba161e54ecf4` | failed | — | Failed shell / no Fly app; still counts toward project service list |
| `golazo-probe3` | `7d02c87c-073f-49a8-8c60-7ba5161665eb` | failed | — | Failed image deploy |
| `golazo-probe2` | `7177f146-d7e1-40b4-b511-9cc2a9649363` | failed | — | Failed registry deploy |
| `golazo-probe-img` | `dc634a68-75d9-478a-a9eb-15924ddfeffa` | failed | — | Failed `node:22-alpine` image deploy |

All listed services: `shared-1x` / 512MB / `iad`.

`compute get` requires **UUID** (name → `invalid input syntax for type uuid`).

## Proposed remove commands (await human OK)

```bash
# Stuck active slot (highest priority if freeing quota)
npx @insforge/cli compute delete 868a0015-72a5-4aee-a041-957fb7acdf1f --json

# Failed shells / images
npx @insforge/cli compute delete 7658ccbc-d95f-447b-b9d6-ba161e54ecf4 --json
npx @insforge/cli compute delete 7d02c87c-073f-49a8-8c60-7ba5161665eb --json
npx @insforge/cli compute delete 7177f146-d7e1-40b4-b511-9cc2a9649363 --json
npx @insforge/cli compute delete dc634a68-75d9-478a-a9eb-15924ddfeffa --json
```

Confirm none are referenced by `PUBLIC_GAME_SERVER_URL` or a teammate before running.

## Edge function deploy (skipped — known failing)

Finite retries already exhausted on 2026-07-10 (`Event iterator validation failed`). **No further deploy attempts this QA pass.**

| Function | Status |
|----------|--------|
| `private-room` | stopped after 2–3 failed deploys; use `POST /room` on game-server |
| `cleanup-rooms` | stopped after 2–3 failed deploys; runtime also 502 historically |

## Notes

- Prefer Railway/Fly for `services/game-server` until Compute quota + health are fixed.
- Local WS acceptance: `pnpm test:mp` / `pnpm mp:acceptance` (see `tools/mp-acceptance/`).
- Full QA report: `tools/mp-acceptance/QA-REPORT.md`.

## Test results (verified 2026-07-10 QA pass)

| Check | Result |
|-------|--------|
| Edge function deploy | **skipped** (known `Event iterator validation failed`) |
| `pnpm test:unit` | **23 passed**, 0 failed |
| `pnpm test:mp` | **8/8 passed** (spawned local game-server) |
| `pnpm mp:acceptance` | **8/8 passed** (local spawn) |
| `services/game-server` tests | **17 passed**, 0 failed |
| `pnpm build` | **exit 0** |
| `pnpm test:e2e` | **27 passed** |
