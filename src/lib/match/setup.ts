import type { Team } from '../mock/teams';
import { createLocalMatchId } from './session';

export const ALLOWED_DURATIONS = [60, 120, 180] as const;
export type MatchDuration = (typeof ALLOWED_DURATIONS)[number];

export const DEFAULT_DURATION: MatchDuration = 180;
export const DEFAULT_PLAYER_TEAM = 'brasil';

export type MatchSetup = {
  localMatchId: string;
  playerTeamId: string;
  opponentTeamId: string;
  homeTeamId: string;
  awayTeamId: string;
  durationSeconds: MatchDuration;
  playerSide: 'home' | 'away';
};

export type MatchSetupInput = {
  playerTeamId?: string;
  opponentTeamId?: string;
  durationSeconds?: number;
  playerSide?: 'home' | 'away';
};

export function validateDuration(seconds: unknown): MatchDuration {
  if (seconds === 60 || seconds === 120 || seconds === 180) {
    return seconds;
  }
  return DEFAULT_DURATION;
}

export function validateOpponent(
  playerId: string,
  opponentId: string,
  teams: Team[],
): string {
  if (opponentId && opponentId !== playerId && teams.some((t) => t.id === opponentId)) {
    return opponentId;
  }
  return pickRandomOpponent(playerId, teams);
}

export function pickRandomOpponent(playerTeamId: string, teams: Team[]): string {
  const candidates = teams.filter((t) => t.id !== playerTeamId);
  if (candidates.length === 0) {
    return teams.find((t) => t.id !== playerTeamId)?.id ?? playerTeamId;
  }
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

export function buildMatchSetup(
  input: Partial<MatchSetupInput>,
  teams: Team[],
  withMatchId = false,
): MatchSetup {
  const playerTeamId =
    input.playerTeamId && teams.some((t) => t.id === input.playerTeamId)
      ? input.playerTeamId
      : DEFAULT_PLAYER_TEAM;

  const opponentTeamId = validateOpponent(
    playerTeamId,
    input.opponentTeamId ?? '',
    teams,
  );

  const playerSide = input.playerSide === 'away' ? 'away' : 'home';
  const durationSeconds = validateDuration(input.durationSeconds);

  const homeTeamId = playerSide === 'home' ? playerTeamId : opponentTeamId;
  const awayTeamId = playerSide === 'home' ? opponentTeamId : playerTeamId;

  return {
    localMatchId: withMatchId ? createLocalMatchId() : '',
    playerTeamId,
    opponentTeamId,
    homeTeamId,
    awayTeamId,
    durationSeconds,
    playerSide,
  };
}

export function finalizeMatchSetup(setup: MatchSetup): MatchSetup {
  return {
    ...setup,
    localMatchId: createLocalMatchId(),
  };
}

export function isValidOpponent(playerId: string, opponentId: string): boolean {
  return Boolean(opponentId) && opponentId !== playerId;
}
