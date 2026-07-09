import { teams } from './teams';

export type TeamRanking = {
  rank: number;
  teamId: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
};

export const globalRankings: TeamRanking[] = [
  { rank: 1, teamId: 'brasil', points: 42, wins: 13, draws: 3, losses: 2, goalsFor: 38, goalsAgainst: 14 },
  { rank: 2, teamId: 'argentina', points: 39, wins: 12, draws: 3, losses: 3, goalsFor: 35, goalsAgainst: 16 },
  { rank: 3, teamId: 'francia', points: 36, wins: 11, draws: 3, losses: 4, goalsFor: 31, goalsAgainst: 18 },
  { rank: 4, teamId: 'japon', points: 34, wins: 10, draws: 4, losses: 4, goalsFor: 28, goalsAgainst: 17 },
  { rank: 5, teamId: 'alemania', points: 32, wins: 9, draws: 5, losses: 4, goalsFor: 27, goalsAgainst: 19 },
  { rank: 6, teamId: 'espana', points: 30, wins: 9, draws: 3, losses: 6, goalsFor: 26, goalsAgainst: 21 },
  { rank: 7, teamId: 'inglaterra', points: 28, wins: 8, draws: 4, losses: 6, goalsFor: 24, goalsAgainst: 20 },
  { rank: 8, teamId: 'portugal', points: 26, wins: 7, draws: 5, losses: 6, goalsFor: 22, goalsAgainst: 22 },
  { rank: 9, teamId: 'mexico', points: 24, wins: 7, draws: 3, losses: 8, goalsFor: 21, goalsAgainst: 25 },
  { rank: 10, teamId: 'uruguay', points: 22, wins: 6, draws: 4, losses: 8, goalsFor: 19, goalsAgainst: 26 },
  { rank: 11, teamId: 'colombia', points: 20, wins: 5, draws: 5, losses: 8, goalsFor: 18, goalsAgainst: 24 },
  { rank: 12, teamId: 'marruecos', points: 18, wins: 4, draws: 6, losses: 8, goalsFor: 16, goalsAgainst: 25 },
];

export function getTopRankings(limit = 5): TeamRanking[] {
  return globalRankings.slice(0, limit);
}

export function getTeamName(teamId: string): string {
  return teams.find((team) => team.id === teamId)?.name ?? teamId;
}
