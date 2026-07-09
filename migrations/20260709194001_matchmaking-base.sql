-- Matchmaking queue for lobby matchmaking (base scaffold)

CREATE TABLE public.match_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES public.teams(id),
  status text NOT NULL DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX match_queue_status_idx ON public.match_queue (status, created_at);
CREATE INDEX match_queue_user_id_idx ON public.match_queue (user_id);

ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_queue_public_read ON public.match_queue
  FOR SELECT TO anon, authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.match_queue FROM anon, authenticated;
GRANT SELECT ON public.match_queue TO anon, authenticated;
