import { createAdminClient, createClient } from 'npm:@insforge/sdk@^0.0.26';

type JoinQueueBody = {
  teamId: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

  let body: JoinQueueBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Cuerpo JSON inválido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.teamId) {
    return new Response(JSON.stringify({ error: 'teamId requerido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  const userToken = authHeader?.replace('Bearer ', '') ?? null;

  let userId: string | null = null;
  if (userToken) {
    const userClient = createClient({ baseUrl, accessToken: userToken });
    const { data } = await userClient.auth.getCurrentUser();
    userId = data?.user?.id ?? null;
  }

  const admin = createAdminClient({ baseUrl, apiKey });

  const { data, error } = await admin.database
    .from('match_queue')
    .insert([{
      user_id: userId,
      team_id: body.teamId,
      status: 'waiting',
    }])
    .select('id, team_id, status, created_at')
    .maybeSingle();

  if (error || !data) {
    return new Response(JSON.stringify({ error: 'No se pudo unir a la cola' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ queueEntry: data }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
