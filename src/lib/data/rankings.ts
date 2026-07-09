import { insforge, isInsForgeConfigured } from '../insforge';
import {
  globalRankings as mockRankings,
  type TeamRanking,
} from '../mock/rankings';
import { getTeams } from './teams';

type RankingRow = {
  team_id: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
};

function mapRanking(row: RankingRow, rank: number): TeamRanking {
  return {
    rank,
    teamId: row.team_id,
    points: row.points,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    goalsFor: row.goals_for,
    goalsAgainst: row.goals_against,
  };
}

export async function getGlobalRankings(): Promise<TeamRanking[]> {
  if (!isInsForgeConfigured || !insforge) {
    return mockRankings;
  }

  const { data, error } = await insforge.database
    .from('team_rankings')
    .select('team_id, points, wins, draws, losses, goals_for, goals_against')
    .order('points', { ascending: false })
    .order('goals_for', { ascending: false });

  if (error || !data?.length) {
    return mockRankings;
  }

  return (data as RankingRow[]).map((row, index) => mapRanking(row, index + 1));
}

export async function getTopRankings(limit = 5): Promise<TeamRanking[]> {
  const rankings = await getGlobalRankings();
  return rankings.slice(0, limit);
}

export async function getTeamName(teamId: string): Promise<string> {
  const teams = await getTeams();
  return teams.find((team) => team.id === teamId)?.name ?? teamId;
}
