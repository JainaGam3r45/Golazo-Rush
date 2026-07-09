import { createAdminClient, createClient } from 'npm:@insforge/sdk@^0.0.26';

type LeaveQueueBody = {
  queueId?: string;
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

  let body: LeaveQueueBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
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

  if (body.queueId) {
    await admin.database.from('match_queue').delete().eq('id', body.queueId);
  } else if (userId) {
    await admin.database.from('match_queue').delete().eq('user_id', userId).eq('status', 'waiting');
  } else {
    return new Response(JSON.stringify({ error: 'queueId o sesión requerida' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
