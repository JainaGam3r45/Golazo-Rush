import { homeStats as mockStats, type HomeStat } from '../mock/stats';
import { getTopRankings, getTeamName } from './rankings';

export type { HomeStat };

export async function getHomeStats(): Promise<HomeStat[]> {
  const stats = mockStats.map((stat) => ({ ...stat }));
  const top = await getTopRankings(1);
  const leader = top[0];

  if (leader) {
    const leaderName = await getTeamName(leader.teamId);
    const leaderStat = stats.find((stat) => stat.label === 'Mejor selección');
    if (leaderStat) {
      leaderStat.value = leaderName;
    }
  }

  return stats;
}

export function getOnlineStatSlot(stats: HomeStat[]): { index: number; stat: HomeStat } | null {
  const index = stats.findIndex((stat) => stat.label === 'Jugadores en línea');
  if (index < 0) return null;
  return { index, stat: stats[index] };
}
