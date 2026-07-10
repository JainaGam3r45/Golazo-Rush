export type LineupRole = 'def' | 'mid' | 'fwd';

export type LineupSlot = {
  nx: number;
  ny: number;
  role: LineupRole;
};

/** 10 outfield slots in own half (normalized 0–1). GK is fixed by the sim. */
export type CustomLineup = LineupSlot[];

export const LINEUP_OUTFIELD_COUNT = 10;

/** Default 11v11 4-4-2 outfield (slot 0 = human mid). */
export const DEFAULT_LINEUP_11V11: CustomLineup = [
  { role: 'mid', nx: 0.38, ny: 0.38 },
  { role: 'def', nx: 0.16, ny: 0.18 },
  { role: 'def', nx: 0.18, ny: 0.38 },
  { role: 'def', nx: 0.18, ny: 0.62 },
  { role: 'def', nx: 0.16, ny: 0.82 },
  { role: 'mid', nx: 0.38, ny: 0.18 },
  { role: 'mid', nx: 0.38, ny: 0.62 },
  { role: 'mid', nx: 0.38, ny: 0.82 },
  { role: 'fwd', nx: 0.52, ny: 0.36 },
  { role: 'fwd', nx: 0.52, ny: 0.64 },
];

const NX_MIN = 0.12;
const NX_MAX = 0.55;
const NY_MIN = 0.08;
const NY_MAX = 0.92;

export function roleFromNx(nx: number): LineupRole {
  if (nx < 0.28) return 'def';
  if (nx < 0.42) return 'mid';
  return 'fwd';
}

export function clampLineupSlot(slot: Partial<LineupSlot> & { nx: number; ny: number }): LineupSlot {
  const nx = Math.min(NX_MAX, Math.max(NX_MIN, slot.nx));
  const ny = Math.min(NY_MAX, Math.max(NY_MIN, slot.ny));
  const role = slot.role === 'def' || slot.role === 'mid' || slot.role === 'fwd' ? slot.role : roleFromNx(nx);
  return { nx, ny, role };
}

export function cloneDefaultLineup(): CustomLineup {
  return DEFAULT_LINEUP_11V11.map((s) => ({ ...s }));
}

export function normalizeLineup(raw: unknown): CustomLineup | null {
  if (!Array.isArray(raw) || raw.length !== LINEUP_OUTFIELD_COUNT) return null;
  const out: CustomLineup = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null;
    const nx = Number((row as { nx?: unknown }).nx);
    const ny = Number((row as { ny?: unknown }).ny);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    out.push(
      clampLineupSlot({
        nx,
        ny,
        role: (row as { role?: LineupRole }).role,
      }),
    );
  }
  return out;
}

export function lineupChatKey(userId: string, createdAt: string, body: string): string {
  return `${userId}|${createdAt}|${body}`;
}

export function chatMessageDedupeKey(msg: { userId: string; createdAt?: string; body: string }): string {
  return `${msg.userId}|${msg.createdAt ?? ''}|${msg.body}`;
}
