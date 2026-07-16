-- Fase 1 online MVP: allow_bots (1 human vs bots) + spectator membership scaffolding

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.match_rooms
  ADD COLUMN IF NOT EXISTS allow_bots boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.match_rooms.allow_bots IS
  'When true, host may start with ≥1 ready human; empty opposite side is filled by bots.';

ALTER TABLE public.match_room_players
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player';

ALTER TABLE public.match_room_players
  DROP CONSTRAINT IF EXISTS match_room_players_role_check;

ALTER TABLE public.match_room_players
  ADD CONSTRAINT match_room_players_role_check
  CHECK (role IN ('player', 'spectator'));

COMMENT ON COLUMN public.match_room_players.role IS
  'player = competing seat; spectator = read-only lobby member (no ready/loadout/start).';

-- Spectators do not occupy home/away seats
ALTER TABLE public.match_room_players
  ALTER COLUMN slot DROP NOT NULL;

ALTER TABLE public.match_room_players
  DROP CONSTRAINT IF EXISTS match_room_players_slot_check;

ALTER TABLE public.match_room_players
  DROP CONSTRAINT IF EXISTS match_room_players_slot_role_check;

ALTER TABLE public.match_room_players
  ADD CONSTRAINT match_room_players_slot_role_check
  CHECK (
    (role = 'player' AND slot IN ('home', 'away'))
    OR (role = 'spectator' AND slot IS NULL)
  );

DROP INDEX IF EXISTS public.match_room_players_active_slot_uidx;

CREATE UNIQUE INDEX match_room_players_active_player_slot_uidx
  ON public.match_room_players (room_id, slot)
  WHERE left_at IS NULL AND role = 'player';

CREATE INDEX IF NOT EXISTS match_room_players_room_role_idx
  ON public.match_room_players (room_id, role)
  WHERE left_at IS NULL;

-- ---------------------------------------------------------------------------
-- Counts / recompute / snapshot
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.room_active_player_count(p_room_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COUNT(*)::integer
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL
    AND p.role = 'player';
$$;

CREATE OR REPLACE FUNCTION public.room_active_spectator_count(p_room_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COUNT(*)::integer
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL
    AND p.role = 'spectator';
$$;

CREATE OR REPLACE FUNCTION public.room_recompute_status(p_room_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status text;
  v_allow_bots boolean;
  v_count integer;
  v_ready_count integer;
  v_configured_count integer;
  v_new_status text;
BEGIN
  SELECT r.status, r.allow_bots INTO v_status, v_allow_bots
  FROM public.match_rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_status IN ('starting', 'playing', 'finished', 'cancelled') THEN
    RETURN v_status;
  END IF;

  SELECT public.room_active_player_count(p_room_id) INTO v_count;

  IF v_count = 0 THEN
    UPDATE public.match_rooms
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_room_id;
    RETURN 'cancelled';
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE p.team_id IS NOT NULL
        AND p.formation_id IS NOT NULL
    ),
    COUNT(*) FILTER (WHERE p.ready)
  INTO v_configured_count, v_ready_count
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL
    AND p.role = 'player';

  IF v_count = 1 THEN
    IF COALESCE(v_allow_bots, false) THEN
      IF v_ready_count = 1 AND v_configured_count = 1 THEN
        v_new_status := 'ready';
      ELSIF v_configured_count = 1 THEN
        v_new_status := 'configuring';
      ELSE
        v_new_status := 'waiting';
      END IF;
    ELSE
      v_new_status := 'waiting';
    END IF;
  ELSE
    IF v_ready_count = v_count AND v_configured_count = v_count THEN
      v_new_status := 'ready';
    ELSE
      v_new_status := 'configuring';
    END IF;
  END IF;

  UPDATE public.match_rooms
  SET status = v_new_status, updated_at = now()
  WHERE id = p_room_id
    AND status IS DISTINCT FROM v_new_status;

  RETURN v_new_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.room_snapshot(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_players jsonb;
BEGIN
  SELECT * INTO v_room FROM public.match_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'userId', p.user_id,
      'slot', p.slot,
      'role', p.role,
      'teamId', p.team_id,
      'formationId', p.formation_id,
      'lineup', p.lineup,
      'ready', p.ready,
      'joinedAt', p.joined_at,
      'lastSeenAt', p.last_seen_at,
      'displayName', pr.display_name,
      'username', pr.username
    )
    ORDER BY
      CASE p.role WHEN 'player' THEN 0 ELSE 1 END,
      CASE p.slot WHEN 'home' THEN 0 WHEN 'away' THEN 1 ELSE 2 END,
      p.joined_at
  ), '[]'::jsonb)
  INTO v_players
  FROM public.match_room_players p
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL;

  RETURN jsonb_build_object(
    'id', v_room.id,
    'code', v_room.code,
    'hostUserId', v_room.host_user_id,
    'status', v_room.status,
    'formatId', v_room.format_id,
    'durationSeconds', v_room.duration_seconds,
    'allowBots', v_room.allow_bots,
    'matchId', v_room.match_id,
    'expiresAt', v_room.expires_at,
    'createdAt', v_room.created_at,
    'updatedAt', v_room.updated_at,
    'players', v_players
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Ready / start: bots-aware
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_room_ready(
  p_user_id uuid,
  p_room_id uuid,
  p_ready boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_role text;
  v_team text;
  v_formation text;
  v_other_team text;
  v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_room
  FROM public.match_rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.status NOT IN ('waiting', 'configuring', 'ready') THEN
    RAISE EXCEPTION 'ROOM_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.role, p.team_id, p.formation_id INTO v_role, v_team, v_formation
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.user_id = p_user_id
    AND p.left_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  IF v_role <> 'player' THEN
    RAISE EXCEPTION 'SPECTATOR_READONLY' USING ERRCODE = 'P0001';
  END IF;

  IF p_ready THEN
    SELECT public.room_active_player_count(p_room_id) INTO v_count;
    IF v_count < 2 AND NOT COALESCE(v_room.allow_bots, false) THEN
      RAISE EXCEPTION 'NEED_OPPONENT' USING ERRCODE = 'P0001';
    END IF;
    IF v_team IS NULL OR v_formation IS NULL THEN
      RAISE EXCEPTION 'LOADOUT_INCOMPLETE' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.team_id INTO v_other_team
    FROM public.match_room_players p
    WHERE p.room_id = p_room_id
      AND p.user_id <> p_user_id
      AND p.left_at IS NULL
      AND p.role = 'player'
    LIMIT 1;

    IF v_other_team IS NOT NULL AND v_other_team = v_team THEN
      RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.match_room_players
  SET ready = p_ready, last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL
    AND role = 'player';

  PERFORM public.room_recompute_status(p_room_id);
  RETURN public.room_snapshot(p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_private_room(
  p_user_id uuid,
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_ready_count integer;
  v_player_count integer;
  v_team_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_room
  FROM public.match_rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.status IN ('starting', 'playing') THEN
    RETURN public.room_snapshot(p_room_id);
  END IF;

  IF v_room.status <> 'ready' THEN
    RAISE EXCEPTION 'NOT_READY' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_room_member(p_room_id, p_user_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.host_user_id <> p_user_id THEN
    RAISE EXCEPTION 'NOT_HOST' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE p.ready),
    COUNT(*),
    COUNT(DISTINCT p.team_id)
  INTO v_ready_count, v_player_count, v_team_count
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL
    AND p.role = 'player';

  IF v_player_count < 1 OR v_ready_count <> v_player_count THEN
    RAISE EXCEPTION 'NOT_READY' USING ERRCODE = 'P0001';
  END IF;

  IF v_player_count = 1 THEN
    IF NOT COALESCE(v_room.allow_bots, false) THEN
      RAISE EXCEPTION 'NEED_OPPONENT' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_player_count = 2 THEN
    IF v_team_count < 2 THEN
      RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'ROOM_FULL' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_rooms
  SET status = 'starting', updated_at = now()
  WHERE id = p_room_id
    AND status = 'ready';

  IF NOT FOUND THEN
    SELECT status INTO v_room.status FROM public.match_rooms WHERE id = p_room_id;
    IF v_room.status IN ('starting', 'playing') THEN
      RETURN public.room_snapshot(p_room_id);
    END IF;
    RAISE EXCEPTION 'START_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  PERFORM realtime.publish(
    'room:' || p_room_id::text,
    'room_starting',
    jsonb_build_object(
      'roomId', p_room_id,
      'countdownSeconds', 5,
      'status', 'starting',
      'allowBots', v_room.allow_bots
    )
  );

  RETURN public.room_snapshot(p_room_id);
END;
$$;

-- Spectators cannot change loadout
CREATE OR REPLACE FUNCTION public.update_room_loadout(
  p_user_id uuid,
  p_room_id uuid,
  p_team_id text DEFAULT NULL,
  p_formation_id text DEFAULT NULL,
  p_lineup jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_player public.match_room_players%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_room FROM public.match_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.status NOT IN ('waiting', 'configuring', 'ready') THEN
    RAISE EXCEPTION 'ROOM_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_player
  FROM public.match_room_players
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  IF v_player.role <> 'player' THEN
    RAISE EXCEPTION 'SPECTATOR_READONLY' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team_id) THEN
      RAISE EXCEPTION 'INVALID_TEAM' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.match_room_players
      WHERE room_id = p_room_id
        AND user_id <> p_user_id
        AND left_at IS NULL
        AND role = 'player'
        AND team_id = p_team_id
    ) THEN
      RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_formation_id IS NOT NULL AND p_formation_id NOT IN ('4-3-3', '4-4-2', '3-5-2', '4-2-3-1') THEN
    RAISE EXCEPTION 'INVALID_FORMATION' USING ERRCODE = 'P0001';
  END IF;

  IF p_lineup IS NOT NULL AND jsonb_typeof(p_lineup) = 'array' AND jsonb_array_length(p_lineup) <> 10 THEN
    RAISE EXCEPTION 'INVALID_LINEUP' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_room_players
  SET
    team_id = COALESCE(p_team_id, team_id),
    formation_id = COALESCE(p_formation_id, formation_id),
    lineup = COALESCE(p_lineup, lineup),
    ready = false,
    last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL
    AND role = 'player';

  UPDATE public.match_room_players
  SET ready = false
  WHERE room_id = p_room_id
    AND left_at IS NULL
    AND role = 'player'
    AND ready = true;

  PERFORM public.room_recompute_status(p_room_id);
  RETURN public.room_snapshot(p_room_id);
END;
$$;

-- Ensure join as player still only counts players for capacity
CREATE OR REPLACE FUNCTION public.join_private_room(
  p_user_id uuid,
  p_code text,
  p_team_id text,
  p_formation_id text DEFAULT '4-4-2'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_normalized text;
  v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  v_normalized := upper(trim(p_code));
  IF v_normalized !~ '^[A-Z2-9]{6}$' THEN
    RAISE EXCEPTION 'INVALID_CODE' USING ERRCODE = 'P0001';
  END IF;

  IF p_formation_id NOT IN ('4-3-3', '4-4-2', '3-5-2', '4-2-3-1') THEN
    RAISE EXCEPTION 'INVALID_FORMATION' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team_id) THEN
    RAISE EXCEPTION 'INVALID_TEAM' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.match_room_players p
    WHERE p.user_id = p_user_id AND p.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_IN_ROOM' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_room
  FROM public.match_rooms r
  WHERE r.code = v_normalized
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.status IN ('cancelled', 'finished', 'playing', 'starting') THEN
    RAISE EXCEPTION 'ROOM_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.expires_at < now() THEN
    UPDATE public.match_rooms SET status = 'cancelled', updated_at = now() WHERE id = v_room.id;
    RAISE EXCEPTION 'ROOM_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.room_active_player_count(v_room.id) INTO v_count;
  IF v_count >= 2 THEN
    RAISE EXCEPTION 'ROOM_FULL' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.match_room_players p
    WHERE p.room_id = v_room.id
      AND p.left_at IS NULL
      AND p.role = 'player'
      AND p.team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.match_room_players (
    room_id, user_id, slot, role, team_id, formation_id, ready
  ) VALUES (
    v_room.id, p_user_id, 'away', 'player', p_team_id, p_formation_id, false
  );

  PERFORM public.room_recompute_status(v_room.id);
  RETURN public.room_snapshot(v_room.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Spectator join
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.join_room_as_spectator(
  p_user_id uuid,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_normalized text;
  v_spec_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  v_normalized := upper(trim(p_code));
  IF v_normalized !~ '^[A-Z2-9]{6}$' THEN
    RAISE EXCEPTION 'INVALID_CODE' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.match_room_players p
    WHERE p.user_id = p_user_id AND p.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_IN_ROOM' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_room
  FROM public.match_rooms r
  WHERE r.code = v_normalized
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.status IN ('cancelled', 'finished') THEN
    RAISE EXCEPTION 'ROOM_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.expires_at < now() THEN
    UPDATE public.match_rooms SET status = 'cancelled', updated_at = now() WHERE id = v_room.id;
    RAISE EXCEPTION 'ROOM_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.room_active_spectator_count(v_room.id) INTO v_spec_count;
  IF v_spec_count >= 8 THEN
    RAISE EXCEPTION 'ROOM_FULL' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.match_room_players (
    room_id, user_id, slot, role, team_id, formation_id, ready
  ) VALUES (
    v_room.id, p_user_id, NULL, 'spectator', NULL, '4-4-2', false
  );

  RETURN public.room_snapshot(v_room.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.join_room_as_spectator_auth(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.join_room_as_spectator(v_uid, p_code);
END;
$$;

REVOKE ALL ON FUNCTION public.join_room_as_spectator(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_room_as_spectator_auth(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.room_active_spectator_count(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.join_room_as_spectator(uuid, text) TO project_admin;
GRANT EXECUTE ON FUNCTION public.join_room_as_spectator_auth(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.room_active_spectator_count(uuid) TO project_admin;

COMMENT ON FUNCTION public.join_room_as_spectator_auth(text) IS
  'Join a private room as a read-only spectator (Fase 1 scaffolding; live WS spectate is Fase 4).';
