import { createAdminClient } from 'npm:@insforge/sdk@^0.0.26';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-cleanup-secret',
};

function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default async function (req: Request): Promise<Response> {
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
  const cleanupSecret = Deno.env.get('ROOM_CLEANUP_SECRET') ?? '';
  const provided = req.headers.get('x-cleanup-secret') ?? '';

  if (!apiKey || !baseUrl) {
    return new Response(JSON.stringify({ error: 'Servidor no configurado' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Fail closed: cleanup must always require a configured shared secret.
  if (!cleanupSecret || !secretsEqual(provided, cleanupSecret)) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createAdminClient({ baseUrl, apiKey });
  const { data, error } = await admin.database.rpc('cleanup_expired_rooms', {});

  if (error) {
    return new Response(JSON.stringify({ error: 'No se pudo limpiar salas', detail: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ cancelled: data ?? 0 }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
