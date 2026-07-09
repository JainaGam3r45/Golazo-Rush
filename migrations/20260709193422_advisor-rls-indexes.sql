-- Advisor remediation: RLS policies, FK indexes, and access-control documentation.
--
-- Public-read tables (teams, team_rankings, matches, live_events, match_players):
-- Golazo Rush is a public sports lobby. Catalog teams, global rankings, match
-- results, activity feed, and match rosters are intentionally readable by anon
-- and authenticated clients. Writes are server-only via edge functions
-- (record-match-result, join-queue) using the admin API key; client DML is
-- revoked below the policy layer.

-- ---------------------------------------------------------------------------
-- profiles: tighten SELECT to own row only (app reads .eq('id', userId) only)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_read ON public.profiles;

CREATE POLICY profiles_read_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

COMMENT ON POLICY profiles_read_own ON public.profiles IS
  'Authenticated users may read only their own profile row.';

-- ---------------------------------------------------------------------------
-- match_players: add missing SELECT policy (RLS was blocking all access)
-- ---------------------------------------------------------------------------

CREATE POLICY match_players_public_read ON public.match_players
  FOR SELECT TO anon, authenticated
  USING (true);

COMMENT ON POLICY match_players_public_read ON public.match_players IS
  'Public match rosters for lobby and live play. Inserts/updates are server-only.';

GRANT SELECT ON public.match_players TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public catalog / leaderboard tables: clarify intentional open SELECT
-- ---------------------------------------------------------------------------

COMMENT ON POLICY teams_public_read ON public.teams IS
  'Intentional public read: national team catalog shown to all visitors.';

COMMENT ON POLICY team_rankings_public_read ON public.team_rankings IS
  'Intentional public read: global leaderboard. Updates via record-match-result edge function.';

COMMENT ON POLICY matches_public_read ON public.matches IS
  'Intentional public read: match history and lobby stats. Inserts via record-match-result edge function.';

COMMENT ON POLICY live_events_public_read ON public.live_events IS
  'Intentional public read: home-page activity feed. Inserts via record-match-result edge function.';

COMMENT ON TABLE public.teams IS
  'National team catalog. Client SELECT only; seed data maintained by migrations.';

COMMENT ON TABLE public.team_rankings IS
  'Aggregated team standings. Client SELECT only; writes via admin edge functions.';

COMMENT ON TABLE public.matches IS
  'Match results and lobby state. Client SELECT only; writes via admin edge functions.';

COMMENT ON TABLE public.live_events IS
  'Public activity feed events. Client SELECT only; writes via admin edge functions.';

COMMENT ON TABLE public.match_players IS
  'Per-match participant rows. Client SELECT only; writes via admin edge functions / triggers.';

-- ---------------------------------------------------------------------------
-- Performance: indexes on unindexed foreign-key columns
-- (regular CREATE INDEX — migrations run inside a transaction)
-- ---------------------------------------------------------------------------

CREATE INDEX live_events_team_id_idx ON public.live_events (team_id);
CREATE INDEX live_events_match_id_idx ON public.live_events (match_id);
CREATE INDEX matches_home_team_id_idx ON public.matches (home_team_id);
CREATE INDEX matches_away_team_id_idx ON public.matches (away_team_id);
CREATE INDEX matches_winner_team_id_idx ON public.matches (winner_team_id);
CREATE INDEX match_players_team_id_idx ON public.match_players (team_id);
CREATE INDEX match_players_user_id_idx ON public.match_players (user_id);
CREATE INDEX profiles_selected_team_id_idx ON public.profiles (selected_team_id);
