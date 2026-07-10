import { createAdminClient } from '@insforge/sdk';

function pointsForResult(goalsFor, goalsAgainst) {
  if (goalsFor > goalsAgainst) return { points: 3, wins: 1, draws: 0, losses: 0 };
  if (goalsFor < goalsAgainst) return { points: 0, wins: 0, draws: 0, losses: 1 };
  return { points: 1, wins: 0, draws: 1, losses: 0 };
}

async function updateTeamRanking(admin, teamId, goalsFor, goalsAgainst) {
  const { data: current } = await admin.database
    .from('team_rankings')
    .select('points, wins, draws, losses, goals_for, goals_against, matches_played')
    .eq('team_id', teamId)
    .maybeSingle();

  const row = current;
  const delta = pointsForResult(goalsFor, goalsAgainst);

  await admin.database
    .from('team_rankings')
    .update({
      points: (row?.points ?? 0) + delta.points,
      wins: (row?.wins ?? 0) + delta.wins,
      draws: (row?.draws ?? 0) + delta.draws,
      losses: (row?.losses ?? 0) + delta.losses,
      goals_for: (row?.goals_for ?? 0) + goalsFor,
      goals_against: (row?.goals_against ?? 0) + goalsAgainst,
      matches_played: (row?.matches_played ?? 0) + 1,
    })
    .eq('team_id', teamId);
}

/**
 * Persist authoritative online result (server scores only — never trust client).
 * Mirrors record-match-result edge function insert path.
 */
export function createResultPersister({ config, log }) {
  return async function persistMatchResult(result) {
    if (!config.insforgeBaseUrl || !config.insforgeApiKey) {
      log.warn('persist_skipped', { reason: 'missing_admin_credentials' });
      return { ok: false, reason: 'missing_admin_credentials' };
    }
    if (!result?.homeTeamId || !result?.awayTeamId) {
      log.warn('persist_skipped', { reason: 'missing_team_ids' });
      return { ok: false, reason: 'missing_team_ids' };
    }
    if (typeof result.homeScore !== 'number' || typeof result.awayScore !== 'number') {
      return { ok: false, reason: 'invalid_scores' };
    }

    const durationSeconds = result.durationSeconds ?? 180;
    const admin = createAdminClient({
      baseUrl: config.insforgeBaseUrl,
      apiKey: config.insforgeApiKey,
    });

    const winnerTeamId =
      result.homeScore > result.awayScore
        ? result.homeTeamId
        : result.homeScore < result.awayScore
          ? result.awayTeamId
          : null;

    try {
      const { data: match, error: matchError } = await admin.database
        .from('matches')
        .insert([
          {
            home_team_id: result.homeTeamId,
            away_team_id: result.awayTeamId,
            home_score: result.homeScore,
            away_score: result.awayScore,
            status: 'finished',
            winner_team_id: winnerTeamId,
            decided_by: 'online',
            duration_seconds: durationSeconds,
            started_at: new Date(Date.now() - durationSeconds * 1000).toISOString(),
            ended_at: new Date().toISOString(),
          },
        ])
        .select('id')
        .maybeSingle();

      if (matchError || !match) {
        log.error('persist_match_failed', { err: matchError?.message });
        return { ok: false, reason: 'insert_failed', detail: matchError?.message };
      }

      const matchId = match.id;
      await updateTeamRanking(admin, result.homeTeamId, result.homeScore, result.awayScore);
      await updateTeamRanking(admin, result.awayTeamId, result.awayScore, result.homeScore);

      const eventType = winnerTeamId ? 'win' : 'draw';
      const eventTeamId = winnerTeamId ?? result.homeTeamId;
      const opponentId = winnerTeamId === result.homeTeamId ? result.awayTeamId : result.homeTeamId;

      await admin.database.from('live_events').insert([
        {
          type: eventType,
          message: `${eventTeamId}|${opponentId}|90`,
          team_id: eventTeamId,
          match_id: matchId,
        },
      ]);

      log.info('persist_match_ok', { matchId, homeScore: result.homeScore, awayScore: result.awayScore });
      return { ok: true, matchId, winnerTeamId };
    } catch (err) {
      log.error('persist_match_exception', { err: err?.message });
      return { ok: false, reason: 'exception', detail: err?.message };
    }
  };
}
