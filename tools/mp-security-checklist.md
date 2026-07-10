# Multiplayer security checklist (Phase A rooms + WS game-server)

Authoritative checklist. **No secrets** in this file. Verify before shipping online match.

## Identity and auth

- [ ] Identity comes from JWT / session only — never trust a client-supplied `userId`.
- [ ] Room RPCs and membership checks use `auth.uid()` (or verified JWT claims), not body fields.
- [ ] WS join uses a verified token; reject missing/invalid tokens with `UNAUTHORIZED`.
- [ ] `WS_AUTH_MODE=test` / `WS_TEST_TOKEN` are **banned in production** (config must refuse to boot).

## Database / RPC (private rooms)

- [ ] `SECURITY DEFINER` functions pin `search_path` (e.g. `pg_catalog, public`) — no mutable path.
- [ ] Admin RPCs with `p_user_id` stay `project_admin` only (game-server / edge). Client entry points are `*_auth` RPCs that use `auth.uid()` with no user-id param; `GRANT EXECUTE` to `authenticated` only.
- [ ] `is_room_member` (or equivalent read helper) available to `authenticated` only as needed for RLS/realtime.
- [ ] Create / join / leave / ready / start are **atomic** (single transaction or equivalent race-safe logic).
- [ ] Enforce max **2** players per room (`ROOM_FULL` / equivalent).
- [ ] Single active membership per user (no double-join across rooms without leave).
- [ ] Set `left_at` on leave, cancel, and finish; empty/abandoned rooms are reclaimable.

## Chat

- [ ] Only room members can send/read chat for that room.
- [ ] Enforce max message length.
- [ ] Rate-limit chat sends per user/connection.
- [ ] Strip / escape HTML (no raw HTML stored or rendered).

## Realtime

- [ ] Channel `room:{id}` (or equivalent) is members-only via RLS / auth binding.
- [ ] Non-members cannot subscribe or receive presence/chat/state events.

## Edge: cleanup-rooms

- [ ] Fail-closed on missing/invalid cleanup secret (no anonymous purge).
- [ ] Secret never logged; never shipped to the browser.

## WebSocket game-server

- [ ] Origin allowlist (`ALLOWED_ORIGINS` / `PUBLIC_APP_ORIGIN`); reject others with **403** on upgrade.
- [ ] Token auth on `join` before room membership.
- [ ] Max **2** connections per `roomId`; third gets `ROOM_FULL`.
- [ ] Room isolation: inputs/state from room A never delivered to room B.
- [ ] Heartbeat / idle timeout cleans dead sockets; empty rooms removed.
- [ ] Never log raw tokens or Authorization headers.
- [ ] Test auth mode disabled in production (see above).

## Match integrity (later)

- [ ] Scores and match results are **server-authoritative** (client reports are hints only).
- [ ] Do not accept client-declared winners/goals without sim validation.

## Ops hygiene

- [ ] Confirm `PUBLIC_GAME_SERVER_URL` points at the intended host before deleting Compute probes.
- [ ] Local acceptance: `pnpm test:mp` / `pnpm mp:acceptance` (see `tools/mp-acceptance/`).