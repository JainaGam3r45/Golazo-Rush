import { recentActivity as mockActivity, type LiveEvent } from '../mock/activity';
import { canUseInsForge, getInsForgeClient } from './source';

type LiveEventRow = {
  id: string;
  type: string;
  message: string;
  team_id: string | null;
  match_id: string | null;
  created_at: string;
};

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));

  if (minutes < 60) {
    return `hace ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h`;
}

function mapEvent(row: LiveEventRow): LiveEvent {
  const parts = row.message.split('|');
  const teamId = row.team_id ?? parts[0] ?? '';
  const opponentId = parts[1] ?? '';
  const minute = Number(parts[2] ?? 0);

  return {
    id: row.id,
    teamId,
    opponentId,
    type: row.type as LiveEvent['type'],
    minute: Number.isFinite(minute) ? minute : 0,
    timestamp: formatRelativeTime(row.created_at),
  };
}

export async function getRecentActivity(limit = 6): Promise<LiveEvent[]> {
  if (!canUseInsForge()) {
    return mockActivity.slice(0, limit);
  }

  const client = getInsForgeClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client.database
    .from('live_events')
    .select('id, type, message, team_id, match_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return (data as LiveEventRow[]).map(mapEvent);
}
