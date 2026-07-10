import type { Team } from '../mock/teams';
import type { FormationId } from './formations';
import { CPU_DEFAULT_FORMATION, DEFAULT_FORMATION, isFormationId } from './formations';
import type { MatchFormatId } from './formats';
import { DEFAULT_MATCH_FORMAT, isMatchFormatId } from './formats';
import { createLocalMatchId } from './session';
import { cloneDefaultLineup, normalizeLineup, type CustomLineup } from './lineup';

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
  formationId: FormationId;
  opponentFormationId: FormationId;
  formatId: MatchFormatId;
  lineup: CustomLineup;
  opponentLineup: CustomLineup;
};

export type MatchSetupInput = {
  playerTeamId?: string;
  opponentTeamId?: string;
  durationSeconds?: number;
  playerSide?: 'home' | 'away';
  formationId?: FormationId;
  opponentFormationId?: FormationId;
  formatId?: MatchFormatId;
  lineup?: CustomLineup;
  opponentLineup?: CustomLineup;
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

  const formationId =
    input.formationId && isFormationId(input.formationId)
      ? input.formationId
      : DEFAULT_FORMATION;
  const opponentFormationId =
    input.opponentFormationId && isFormationId(input.opponentFormationId)
      ? input.opponentFormationId
      : CPU_DEFAULT_FORMATION;
  const formatId =
    input.formatId && isMatchFormatId(input.formatId) ? input.formatId : DEFAULT_MATCH_FORMAT;
  const lineup = normalizeLineup(input.lineup) ?? cloneDefaultLineup();
  const opponentLineup = normalizeLineup(input.opponentLineup) ?? cloneDefaultLineup();

  return {
    localMatchId: withMatchId ? createLocalMatchId() : '',
    playerTeamId,
    opponentTeamId,
    homeTeamId,
    awayTeamId,
    durationSeconds,
    playerSide,
    formationId,
    opponentFormationId,
    formatId,
    lineup,
    opponentLineup,
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
