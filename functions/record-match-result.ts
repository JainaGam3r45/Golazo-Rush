import { createAdminClient } from 'npm:@insforge/sdk@^0.0.26';

type MatchResultBody = {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  durationSeconds?: number;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function pointsForResult(goalsFor: number, goalsAgainst: number): { points: number; wins: number; draws: number; losses: number } {
  if (goalsFor > goalsAgainst) return { points: 3, wins: 1, draws: 0, losses: 0 };
  if (goalsFor < goalsAgainst) return { points: 0, wins: 0, draws: 0, losses: 1 };
  return { points: 1, wins: 0, draws: 1, losses: 0 };
}

async function updateTeamRanking(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string,
  goalsFor: number,
  goalsAgainst: number,
): Promise<void> {
  const { data: current } = await admin.database
    .from('team_rankings')
    .select('points, wins, draws, losses, goals_for, goals_against, matches_played')
    .eq('team_id', teamId)
    .maybeSingle();

  const row = current as {
    points: number;
    wins: number;
    draws: number;
    losses: number;
    goals_for: number;
    goals_against: number;
    matches_played: number;
  } | null;

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

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('INSFORGE_API_KEY');
  const baseUrl = Deno.env.get('INSFORGE_BASE_URL');

  if (!apiKey || !baseUrl) {
    return new Response(JSON.stringify({ error: 'Servidor no configurado' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: MatchResultBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Cuerpo JSON inválido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { homeTeamId, awayTeamId, homeScore, awayScore, durationSeconds = 180 } = body;

  if (
    !homeTeamId ||
    !awayTeamId ||
    typeof homeScore !== 'number' ||
    typeof awayScore !== 'number' ||
    homeScore < 0 ||
    awayScore < 0
  ) {
    return new Response(JSON.stringify({ error: 'Datos de partida inválidos' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createAdminClient({ baseUrl, apiKey });

  const winnerTeamId =
    homeScore > awayScore ? homeTeamId : homeScore < awayScore ? awayTeamId : null;

  const { data: match, error: matchError } = await admin.database
    .from('matches')
    .insert([{
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      home_score: homeScore,
      away_score: awayScore,
      status: 'finished',
      winner_team_id: winnerTeamId,
      decided_by: 'local',
      duration_seconds: durationSeconds,
      started_at: new Date(Date.now() - durationSeconds * 1000).toISOString(),
      ended_at: new Date().toISOString(),
    }])
    .select('id')
    .maybeSingle();

  if (matchError || !match) {
    return new Response(JSON.stringify({ error: 'No se pudo guardar la partida' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const matchId = (match as { id: string }).id;

  await updateTeamRanking(admin, homeTeamId, homeScore, awayScore);
  await updateTeamRanking(admin, awayTeamId, awayScore, homeScore);

  const eventType = winnerTeamId ? 'win' : 'draw';
  const eventTeamId = winnerTeamId ?? homeTeamId;
  const opponentId = winnerTeamId === homeTeamId ? awayTeamId : homeTeamId;

  await admin.database.from('live_events').insert([{
    type: eventType,
    message: `${eventTeamId}|${opponentId}|90`,
    team_id: eventTeamId,
    match_id: matchId,
  }]);

  return new Response(
    JSON.stringify({ matchId, homeScore, awayScore, winnerTeamId }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
