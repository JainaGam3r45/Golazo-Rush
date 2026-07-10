/**
 * Pure helpers for private-room status labels and loadout rules.
 * Edge/SQL remain the source of truth; these mirror client-side checks.
 */

export const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidRoomCode(raw: string): boolean {
  return ROOM_CODE_RE.test(normalizeRoomCode(raw));
}

export function sanitizeChatMessage(raw: string): { ok: true; body: string } | { ok: false; code: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, code: 'EMPTY_MESSAGE' };
  if (trimmed.length > 200) return { ok: false, code: 'MESSAGE_TOO_LONG' };
  return { ok: true, body: trimmed.replace(/[<>]/g, '') };
}

export function wouldClearReadyOnLoadoutChange(prev: {
  teamId: string | null;
  formationId: string;
  ready: boolean;
}, next: { teamId?: string; formationId?: string }): boolean {
  if (!prev.ready) return false;
  if (next.teamId !== undefined && next.teamId !== prev.teamId) return true;
  if (next.formationId !== undefined && next.formationId !== prev.formationId) return true;
  return false;
}

export function teamsConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a === b);
}

export function canStartRoom(input: {
  status: string;
  playerCount: number;
  readyCount: number;
  distinctTeams: number;
  requesterIsHost: boolean;
}): { ok: true } | { ok: false; code: string } {
  if (!input.requesterIsHost) return { ok: false, code: 'NOT_HOST' };
  if (input.status === 'starting' || input.status === 'playing') return { ok: true };
  if (input.status !== 'ready') return { ok: false, code: 'NOT_READY' };
  if (input.playerCount !== 2 || input.readyCount !== 2) return { ok: false, code: 'NOT_READY' };
  if (input.distinctTeams < 2) return { ok: false, code: 'TEAM_TAKEN' };
  return { ok: true };
}

export function canJoinRoom(input: {
  found: boolean;
  status: string;
  expired: boolean;
  activeCount: number;
  alreadyInAnyRoom: boolean;
  teamTaken: boolean;
}): { ok: true } | { ok: false; code: string } {
  if (input.alreadyInAnyRoom) return { ok: false, code: 'ALREADY_IN_ROOM' };
  if (!input.found) return { ok: false, code: 'ROOM_NOT_FOUND' };
  if (input.expired) return { ok: false, code: 'ROOM_EXPIRED' };
  if (['cancelled', 'finished', 'playing', 'starting'].includes(input.status)) {
    return { ok: false, code: 'ROOM_CLOSED' };
  }
  if (input.activeCount >= 2) return { ok: false, code: 'ROOM_FULL' };
  if (input.teamTaken) return { ok: false, code: 'TEAM_TAKEN' };
  return { ok: true };
}
