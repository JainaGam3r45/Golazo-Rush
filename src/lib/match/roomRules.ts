/**
 * Pure helpers for private-room status labels and loadout rules.
 * Edge/SQL remain the source of truth; these mirror client-side checks.
 */

import { MAX_HUMANS_PER_SIDE, MAX_HUMANS_TOTAL } from './roomTypes.ts';

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
  allowBots?: boolean;
  /** Number of sides (home/away) with at least one human. */
  sidesWithHumans?: number;
}): { ok: true } | { ok: false; code: string } {
  if (!input.requesterIsHost) return { ok: false, code: 'NOT_HOST' };
  if (input.status === 'starting' || input.status === 'playing') return { ok: true };
  if (input.status !== 'ready') return { ok: false, code: 'NOT_READY' };
  if (
    input.playerCount < 1 ||
    input.playerCount > MAX_HUMANS_TOTAL ||
    input.readyCount !== input.playerCount
  ) {
    return { ok: false, code: 'NOT_READY' };
  }
  if (input.playerCount === 1) {
    if (!input.allowBots) return { ok: false, code: 'NEED_OPPONENT' };
    return { ok: true };
  }
  const sides = input.sidesWithHumans ?? input.distinctTeams;
  if (sides >= 2 && input.distinctTeams < 2) {
    return { ok: false, code: 'TEAM_TAKEN' };
  }
  if (sides < 2 && !input.allowBots) {
    return { ok: false, code: 'NEED_OPPONENT' };
  }
  return { ok: true };
}

export function canJoinRoom(input: {
  found: boolean;
  status: string;
  expired: boolean;
  activeCount: number;
  alreadyInAnyRoom: boolean;
  teamTaken: boolean;
  asSpectator?: boolean;
  spectatorCount?: number;
  sideCount?: number;
}): { ok: true } | { ok: false; code: string } {
  if (input.alreadyInAnyRoom) return { ok: false, code: 'ALREADY_IN_ROOM' };
  if (!input.found) return { ok: false, code: 'ROOM_NOT_FOUND' };
  if (input.expired) return { ok: false, code: 'ROOM_EXPIRED' };
  if (input.asSpectator) {
    if (['cancelled', 'finished'].includes(input.status)) {
      return { ok: false, code: 'ROOM_CLOSED' };
    }
    if ((input.spectatorCount ?? 0) >= 8) return { ok: false, code: 'ROOM_FULL' };
    return { ok: true };
  }
  if (['cancelled', 'finished', 'playing', 'starting'].includes(input.status)) {
    return { ok: false, code: 'ROOM_CLOSED' };
  }
  if (input.activeCount >= MAX_HUMANS_TOTAL) return { ok: false, code: 'ROOM_FULL' };
  if ((input.sideCount ?? 0) >= MAX_HUMANS_PER_SIDE) return { ok: false, code: 'SIDE_FULL' };
  if (input.teamTaken) return { ok: false, code: 'TEAM_TAKEN' };
  return { ok: true };
}

export function canClaimSeat(input: {
  status: string;
  isPlayer: boolean;
  seatTakenByOther: boolean;
  sideFull: boolean;
  fieldSlot: number;
}): { ok: true } | { ok: false; code: string } {
  if (!input.isPlayer) return { ok: false, code: 'SPECTATOR_READONLY' };
  if (!['waiting', 'configuring', 'ready'].includes(input.status)) {
    return { ok: false, code: 'ROOM_LOCKED' };
  }
  if (input.fieldSlot < 0 || input.fieldSlot > 3) return { ok: false, code: 'INVALID_SEAT' };
  if (input.seatTakenByOther) return { ok: false, code: 'SEAT_TAKEN' };
  if (input.sideFull) return { ok: false, code: 'SIDE_FULL' };
  return { ok: true };
}
