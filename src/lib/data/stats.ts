import { homeStats as mockStats, type HomeStat } from '../mock/stats';
import { getTeamName, getTopRankings } from './rankings';
import { canUseInsForge, getInsForgeClient } from './source';

export type { HomeStat };

function formatStatNumber(value: number): string {
  return value.toLocaleString('es-AR');
}

function emptyStats(): HomeStat[] {
  return [
    { label: 'Jugadores en línea', value: '—' },
    { label: 'Partidos hoy', value: '0' },
    { label: 'Goles marcados', value: '0' },
    { label: 'Mejor selección', value: '—' },
  ];
}

async function fetchHomeStatsFromDb(): Promise<HomeStat[] | null> {
  const client = getInsForgeClient();
  if (!client) return null;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [matchesTodayResult, goalsResult] = await Promise.all([
    client.database
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay.toISOString()),
    client.database.from('matches').select('home_score, away_score'),
  ]);

  if (matchesTodayResult.error || goalsResult.error) {
    return null;
  }

  const matchesToday = matchesTodayResult.count ?? 0;
  const totalGoals =
    (goalsResult.data as Array<{ home_score: number; away_score: number }> | null)?.reduce(
      (sum, match) => sum + match.home_score + match.away_score,
      0,
    ) ?? 0;

  const stats = emptyStats();
  stats.find((stat) => stat.label === 'Partidos hoy')!.value = formatStatNumber(matchesToday);
  stats.find((stat) => stat.label === 'Goles marcados')!.value = formatStatNumber(totalGoals);

  const top = await getTopRankings(1);
  const leader = top[0];
  if (leader && leader.points > 0) {
    const leaderName = await getTeamName(leader.teamId);
    stats.find((stat) => stat.label === 'Mejor selección')!.value = leaderName;
  }

  return stats;
}

export async function getHomeStats(): Promise<HomeStat[]> {
  if (!canUseInsForge()) {
    return mockStats.map((stat) => ({ ...stat }));
  }

  const stats = await fetchHomeStatsFromDb();
  return stats ?? emptyStats();
}

export function getOnlineStatSlot(stats: HomeStat[]): { index: number; stat: HomeStat } | null {
  const index = stats.findIndex((stat) => stat.label === 'Jugadores en línea');
  if (index < 0) return null;
  return { index, stat: stats[index] };
}
