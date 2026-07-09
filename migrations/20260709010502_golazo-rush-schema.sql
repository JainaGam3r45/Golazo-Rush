-- Golazo Rush initial schema

CREATE TABLE public.teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL,
  color_primary text NOT NULL,
  color_secondary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.team_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  points integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  draws integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  goals_for integer NOT NULL DEFAULT 0,
  goals_against integer NOT NULL DEFAULT 0,
  matches_played integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id)
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  display_name text,
  selected_team_id text REFERENCES public.teams(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team_id text NOT NULL REFERENCES public.teams(id),
  away_team_id text NOT NULL REFERENCES public.teams(id),
  home_score integer NOT NULL DEFAULT 0,
  away_score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled',
  winner_team_id text REFERENCES public.teams(id),
  decided_by text,
  duration_seconds integer NOT NULL DEFAULT 180,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.match_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  team_id text NOT NULL REFERENCES public.teams(id),
  goals integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  saves integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.live_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  message text NOT NULL,
  team_id text REFERENCES public.teams(id) ON DELETE SET NULL,
  match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX team_rankings_points_idx ON public.team_rankings (points DESC, goals_for DESC);
CREATE INDEX live_events_created_at_idx ON public.live_events (created_at DESC);
CREATE INDEX matches_status_idx ON public.matches (status);
CREATE INDEX match_players_match_id_idx ON public.match_players (match_id);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

CREATE TRIGGER team_rankings_updated_at
  BEFORE UPDATE ON public.team_rankings
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

-- Seed teams
INSERT INTO public.teams (id, name, code, color_primary, color_secondary) VALUES
  ('argentina', 'Argentina', 'ARG', '#74acdf', '#ffffff'),
  ('brasil', 'Brasil', 'BRA', '#009c3b', '#ffdf00'),
  ('espana', 'España', 'ESP', '#c60b1e', '#ffc400'),
  ('francia', 'Francia', 'FRA', '#002395', '#ed2939'),
  ('alemania', 'Alemania', 'GER', '#000000', '#ffce00'),
  ('portugal', 'Portugal', 'POR', '#006600', '#ff0000'),
  ('inglaterra', 'Inglaterra', 'ENG', '#ffffff', '#ce1124'),
  ('mexico', 'México', 'MEX', '#006847', '#ce1126'),
  ('uruguay', 'Uruguay', 'URU', '#0038a8', '#ffffff'),
  ('colombia', 'Colombia', 'COL', '#fcd116', '#003893'),
  ('japon', 'Japón', 'JPN', '#bc002d', '#ffffff'),
  ('marruecos', 'Marruecos', 'MAR', '#c1272d', '#006233');

INSERT INTO public.team_rankings (team_id)
SELECT id FROM public.teams;

-- RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY teams_public_read ON public.teams
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY team_rankings_public_read ON public.team_rankings
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY live_events_public_read ON public.live_events
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY matches_public_read ON public.matches
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY profiles_read ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.teams FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.team_rankings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.live_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.matches FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.match_players FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon;
REVOKE DELETE ON public.profiles FROM authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.teams TO anon, authenticated;
GRANT SELECT ON public.team_rankings TO anon, authenticated;
GRANT SELECT ON public.live_events TO anon, authenticated;
GRANT SELECT ON public.matches TO anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;

-- Realtime channel patterns
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES
  ('global:ranking', 'Actualizaciones del ranking global', true),
  ('global:activity', 'Feed de actividad en vivo', true),
  ('lobby:main', 'Canal principal del lobby', true)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;
