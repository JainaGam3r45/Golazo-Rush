# @golazo-rush/game-sim

Headless, pure TypeScript 5v5 match simulation for the Golazo Rush online MVP.

No Phaser, DOM, `window`, Astro, or audio. Each match is an isolated instance (no module-level possession singletons).

## Install / workspace

This package lives at `packages/game-sim` and is named `@golazo-rush/game-sim`.

From the repo root (pnpm workspace):

```bash
pnpm install
pnpm --filter @golazo-rush/game-sim test
```

Or inside the package:

```bash
cd packages/game-sim
pnpm test
```

Zero runtime dependencies. Tests use Node's built-in test runner (`node --experimental-strip-types --test`).

## Quick start (game-server)

```ts
import {
  createMatch,
  type MatchSnapshot,
  type PlayerInput,
} from '@golazo-rush/game-sim';

const match = createMatch({
  durationSeconds: 180,
  homeFormationId: '4-4-2',
  awayFormationId: '4-3-3',
  homeHumanPlayerId: 'user-home',
  awayHumanPlayerId: 'user-away',
});

// Option A: pass inputs with tick
const snap: MatchSnapshot = match.tick(1000 / 60, {
  'user-home': {
    dirx: 1,
    diry: 0,
    sprint: false,
    shoot: false,
    pass: false,
    clear: false,
    tackle: false,
    seq: 1,
  },
});

// Option B: queue then tick
match.applyInput('user-away', {
  dirx: -1,
  diry: 0.2,
  sprint: true,
  shoot: false,
  pass: false,
  clear: false,
  tackle: false,
  seq: 1,
});
match.tick(16);

if (match.isFinished()) {
  console.log(match.getSnapshot().score);
}
```

## Exports

| Export | Kind | Description |
|--------|------|-------------|
| `createMatch(config?)` | function | Creates an isolated match instance |
| `Match` | type | Instance API |
| `MatchConfig` | type | Creation options |
| `PlayerInput` | type | Per-player input DTO |
| `MatchSnapshot` | type | JSON-serializable state for network |
| `PlayerSnapshot` / `BallSnapshot` | type | Nested snapshot shapes |
| `MatchPhase` | type | `'playing' \| 'goal' \| 'setPiece' \| 'finished'` |
| `Side` / `FormationId` / `BallState` / … | type | Shared enums |
| `PITCH_WIDTH` / `PITCH_HEIGHT` / `TEAM_SIZE_5V5` / … | const | Pitch & format constants |

### `createMatch(config?: MatchConfig): Match`

```ts
type MatchConfig = {
  durationSeconds?: number;       // default 180
  homeFormationId?: FormationId;  // default '4-4-2'
  awayFormationId?: FormationId;
  homeHumanPlayerId?: string;     // outfield slot 0 on home
  awayHumanPlayerId?: string;     // outfield slot 0 on away
  seed?: number;                  // reserved
  initialBall?: { x: number; y: number; vx?: number; vy?: number }; // tests / replays
};
```

Roster is always **5v5**: 1 GK + 4 outfield per side. Slot `0` on each side becomes human when the corresponding player id is set; remaining outfield slots and both GKs are simple bots.

### `Match` API

```ts
applyInput(playerId: string, input: PlayerInput): void
tick(dtMs: number, inputsByPlayerId?: Record<string, PlayerInput>): MatchSnapshot
getSnapshot(): MatchSnapshot
getPhase(): MatchPhase
isFinished(): boolean
```

- `dtMs` is clamped (max 50ms) to avoid spiral-of-death on hitch.
- Inputs with `seq` lower than the last applied seq for that player are ignored.
- Clock only advances while `phase === 'playing'`.
- On goal: score updates, phase becomes `'goal'` for ~1.2s, positions reset, then `'playing'` resumes.
- When `clockSeconds >= durationSeconds`, phase becomes `'finished'`.

### `PlayerInput`

```ts
type PlayerInput = {
  dirx: number;   // -1..1
  diry: number;   // -1..1
  sprint: boolean;
  shoot: boolean;
  pass: boolean;
  clear: boolean;
  tackle: boolean;
  seq: number;    // monotonic per player
};
```

### `MatchSnapshot` (network)

JSON-serializable. Includes `tick`, `timeMs`, `clockSeconds`, `durationSeconds`, `phase`, `score`, `ball`, `players`, and `humanSlots`.

Ball fields: `x`, `y`, `vx`, `vy`, `state`, `controllerId`, `lastTouchSide`.

Player fields: `id`, `side`, `slot`, `role`, `kind`, `x`, `y`, `vx`, `vy`.

## Scope / non-goals

Covered: movement, ball physics (drag/bounce), possession, shoot/pass/clear/tackle, simple bots + GK, goals, clock, phases (`playing` / `goal` / `finished`; `setPiece` reserved).

Not covered: full set pieces, penalties, 11v11, polished AI, audio/VFX.

## Suggested server loop

```ts
const TICK_MS = 1000 / 60;
setInterval(() => {
  const inputs = drainClientInputs(); // Record<playerId, PlayerInput>
  const snap = match.tick(TICK_MS, inputs);
  broadcast(snap);
}, TICK_MS);
```
