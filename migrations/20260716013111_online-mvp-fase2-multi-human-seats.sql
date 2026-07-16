-- Fase 2 online MVP: multi-human seats (max 4 humans, max 2 per side)
-- field_slot 0–3 outfield indices; UI exposes seats 0–1 per side; GK stays bot

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.match_room_players
  ADD COLUMN IF NOT EXISTS field_slot smallint;

COMMENT ON COLUMN public.match_room_players.field_slot IS
  'Outfield index 0–3 for human-controlled pitch slots; NULL for spectators.';

-- Backfill all player rows (including left): one human per side historically → slot 0
UPDATE public.match_room_players
SET field_slot = 0
WHERE role = 'player'
  AND field_slot IS NULL
  AND slot IN ('home', 'away');

-- Spectators must not carry a field_slot
UPDATE public.match_room_players
SET field_slot = NULL
WHERE role = 'spectator';

ALTER TABLE public.match_room_players
  DROP CONSTRAINT IF EXISTS match_room_players_slot_role_check;

ALTER TABLE public.match_room_players
  ADD CONSTRAINT match_room_players_slot_role_check
  CHECK (
    left_at IS NOT NULL
    OR (
      role = 'player'
      AND slot IN ('home', 'away')
      AND field_slot IS NOT NULL
      AND field_slot BETWEEN 0 AND 3
    )
    OR (role = 'spectator' AND slot IS NULL AND field_slot IS NULL)
  );

DROP INDEX IF EXISTS public.match_room_players_active_player_slot_uidx;

CREATE UNIQUE INDEX match_room_players_active_seat_uidx
  ON public.match_room_players (room_id, slot, field_slot)
  WHERE left_at IS NULL AND role = 'player';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.room_side_player_count(p_room_id uuid, p_side text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COUNT(*)::integer
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL
    AND p.role = 'player'
    AND p.slot = p_side;
$$;

CREATE OR REPLACE FUNCTION public.room_find_free_seat(p_room_id uuid)
RETURNS TABLE (side text, field_slot smallint)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_side text;
  v_slot smallint;
BEGIN
  -- Prefer filling away first (host owns home/0), then second seats
  FOREACH v_side IN ARRAY ARRAY['away', 'home'] LOOP
    FOR v_slot IN 0..1 LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.match_room_players p
        WHERE p.room_id = p_room_id
          AND p.left_at IS NULL
          AND p.role = 'player'
          AND p.slot = v_side
          AND p.field_slot = v_slot
      ) THEN
        IF public.room_side_player_count(p_room_id, v_side) < 2 THEN
          side := v_side;
          field_slot := v_slot;
          RETURN NEXT;
          RETURN;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN;
END;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot includes fieldSlot
-- ---------------------------------------------------------------------------

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
      'fieldSlot', p.field_slot,
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
      COALESCE(p.field_slot, 99),
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
-- Create / join with field_slot
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_private_room(
  p_user_id uuid,
  p_team_id text,
  p_formation_id text DEFAULT '4-4-2',
  p_duration_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room_id uuid;
  v_code text;
  v_attempt int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.match_room_players WHERE user_id = p_user_id AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_IN_ROOM' USING ERRCODE = 'P0001';
  END IF;

  IF p_duration_seconds NOT IN (600, 900, 1800, 2700) THEN
    RAISE EXCEPTION 'INVALID_DURATION' USING ERRCODE = 'P0001';
  END IF;

  IF p_formation_id NOT IN ('4-3-3', '4-4-2', '3-5-2', '4-2-3-1') THEN
    RAISE EXCEPTION 'INVALID_FORMATION' USING ERRCODE = 'P0001';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    v_code := translate(v_code, 'OIL01', 'ABC23');
    BEGIN
      INSERT INTO public.match_rooms (
        code, host_user_id, status, format_id, duration_seconds, expires_at
      ) VALUES (
        v_code, p_user_id, 'waiting', '11v11', p_duration_seconds, now() + interval '30 minutes'
      )
      RETURNING id INTO v_room_id;

      INSERT INTO public.match_room_players (
        room_id, user_id, slot, field_slot, role, team_id, formation_id, ready
      ) VALUES (
        v_room_id, p_user_id, 'home', 0, 'player', p_team_id, p_formation_id, false
      );
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 8 THEN
        RAISE EXCEPTION 'ROOM_CODE_COLLISION' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  PERFORM realtime.publish(('room:' || v_room_id::text), 'room_updated', public.room_snapshot(v_room_id));
  RETURN public.room_snapshot(v_room_id);
END;
$$;

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
  v_side text;
  v_field smallint;
  v_team text;
  v_side_team text;
  v_opp_team text;
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
  IF v_count >= 4 THEN
    RAISE EXCEPTION 'ROOM_FULL' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.side, s.field_slot INTO v_side, v_field
  FROM public.room_find_free_seat(v_room.id) s
  LIMIT 1;

  IF v_side IS NULL THEN
    RAISE EXCEPTION 'ROOM_FULL' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.team_id INTO v_side_team
  FROM public.match_room_players p
  WHERE p.room_id = v_room.id
    AND p.left_at IS NULL
    AND p.role = 'player'
    AND p.slot = v_side
    AND p.team_id IS NOT NULL
  LIMIT 1;

  SELECT p.team_id INTO v_opp_team
  FROM public.match_room_players p
  WHERE p.room_id = v_room.id
    AND p.left_at IS NULL
    AND p.role = 'player'
    AND p.slot IS DISTINCT FROM v_side
    AND p.team_id IS NOT NULL
  LIMIT 1;

  v_team := COALESCE(v_side_team, p_team_id);
  IF v_opp_team IS NOT NULL AND v_team = v_opp_team THEN
    RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.match_room_players (
    room_id, user_id, slot, field_slot, role, team_id, formation_id, ready
  ) VALUES (
    v_room.id, p_user_id, v_side, v_field, 'player', v_team, p_formation_id, false
  );

  PERFORM public.room_recompute_status(v_room.id);
  PERFORM realtime.publish(('room:' || v_room.id::text), 'room_updated', public.room_snapshot(v_room.id));
  RETURN public.room_snapshot(v_room.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Claim / switch seat
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_room_seat(
  p_user_id uuid,
  p_room_id uuid,
  p_side text,
  p_field_slot integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_player public.match_room_players%ROWTYPE;
  v_side_count integer;
  v_side_team text;
  v_opp_team text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF p_side NOT IN ('home', 'away') THEN
    RAISE EXCEPTION 'INVALID_SEAT' USING ERRCODE = 'P0001';
  END IF;

  IF p_field_slot IS NULL OR p_field_slot < 0 OR p_field_slot > 3 THEN
    RAISE EXCEPTION 'INVALID_SEAT' USING ERRCODE = 'P0001';
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

  -- Already on this seat
  IF v_player.slot = p_side AND v_player.field_slot = p_field_slot THEN
    RETURN public.room_snapshot(p_room_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.match_room_players p
    WHERE p.room_id = p_room_id
      AND p.left_at IS NULL
      AND p.role = 'player'
      AND p.slot = p_side
      AND p.field_slot = p_field_slot
      AND p.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'SEAT_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  IF v_player.slot IS DISTINCT FROM p_side THEN
    SELECT public.room_side_player_count(p_room_id, p_side) INTO v_side_count;
    IF v_side_count >= 2 THEN
      RAISE EXCEPTION 'SIDE_FULL' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT p.team_id INTO v_side_team
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL
    AND p.role = 'player'
    AND p.slot = p_side
    AND p.user_id <> p_user_id
    AND p.team_id IS NOT NULL
  LIMIT 1;

  SELECT p.team_id INTO v_opp_team
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL
    AND p.role = 'player'
    AND p.slot IS DISTINCT FROM p_side
    AND p.team_id IS NOT NULL
  LIMIT 1;

  IF v_side_team IS NOT NULL AND v_opp_team IS NOT NULL AND v_side_team = v_opp_team THEN
    RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_room_players
  SET
    slot = p_side,
    field_slot = p_field_slot,
    team_id = COALESCE(v_side_team, team_id),
    ready = false,
    last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL
    AND role = 'player';

  -- Switching side invalidates everyone else's ready (loadout may conflict)
  UPDATE public.match_room_players
  SET ready = false
  WHERE room_id = p_room_id
    AND left_at IS NULL
    AND role = 'player'
    AND ready = true;

  PERFORM public.room_recompute_status(p_room_id);
  PERFORM realtime.publish(('room:' || p_room_id::text), 'room_updated', public.room_snapshot(p_room_id));
  RETURN public.room_snapshot(p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_room_seat_auth(
  p_room_id uuid,
  p_side text,
  p_field_slot integer
)
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
  RETURN public.claim_room_seat(v_uid, p_room_id, p_side, p_field_slot);
END;
$$;

-- ---------------------------------------------------------------------------
-- Ready / loadout / start: multi-human aware
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
  v_slot text;
  v_opp_team text;
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

  SELECT p.role, p.team_id, p.formation_id, p.slot
  INTO v_role, v_team, v_formation, v_slot
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
    IF v_count < 1 THEN
      RAISE EXCEPTION 'NOT_READY' USING ERRCODE = 'P0001';
    END IF;
    IF v_count = 1 AND NOT COALESCE(v_room.allow_bots, false) THEN
      RAISE EXCEPTION 'NEED_OPPONENT' USING ERRCODE = 'P0001';
    END IF;
    IF v_team IS NULL OR v_formation IS NULL THEN
      RAISE EXCEPTION 'LOADOUT_INCOMPLETE' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.team_id INTO v_opp_team
    FROM public.match_room_players p
    WHERE p.room_id = p_room_id
      AND p.user_id <> p_user_id
      AND p.left_at IS NULL
      AND p.role = 'player'
      AND p.slot IS DISTINCT FROM v_slot
      AND p.team_id IS NOT NULL
    LIMIT 1;

    IF v_opp_team IS NOT NULL AND v_opp_team = v_team THEN
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
    -- Opposite side only (teammates share team)
    IF EXISTS (
      SELECT 1 FROM public.match_room_players
      WHERE room_id = p_room_id
        AND user_id <> p_user_id
        AND left_at IS NULL
        AND role = 'player'
        AND slot IS DISTINCT FROM v_player.slot
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

  -- Sync team to same-side teammates when host/player picks a team
  IF p_team_id IS NOT NULL THEN
    UPDATE public.match_room_players
    SET team_id = p_team_id, ready = false
    WHERE room_id = p_room_id
      AND left_at IS NULL
      AND role = 'player'
      AND slot = v_player.slot
      AND user_id <> p_user_id;
  END IF;

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
  v_home_teams integer;
  v_away_teams integer;
  v_sides integer;
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
    COUNT(DISTINCT p.slot),
    COUNT(DISTINCT p.team_id) FILTER (WHERE p.slot = 'home' AND p.team_id IS NOT NULL),
    COUNT(DISTINCT p.team_id) FILTER (WHERE p.slot = 'away' AND p.team_id IS NOT NULL)
  INTO v_ready_count, v_player_count, v_sides, v_home_teams, v_away_teams
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL
    AND p.role = 'player';

  IF v_player_count < 1 OR v_player_count > 4 OR v_ready_count <> v_player_count THEN
    RAISE EXCEPTION 'NOT_READY' USING ERRCODE = 'P0001';
  END IF;

  IF v_player_count = 1 THEN
    IF NOT COALESCE(v_room.allow_bots, false) THEN
      RAISE EXCEPTION 'NEED_OPPONENT' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Multi-human: opposite sides must use different teams when both sides seated
    IF v_sides >= 2 THEN
      IF COALESCE(v_home_teams, 0) > 1 OR COALESCE(v_away_teams, 0) > 1 THEN
        RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.match_room_players h
        JOIN public.match_room_players a
          ON a.room_id = h.room_id
         AND a.left_at IS NULL
         AND a.role = 'player'
         AND a.slot = 'away'
        WHERE h.room_id = p_room_id
          AND h.left_at IS NULL
          AND h.role = 'player'
          AND h.slot = 'home'
          AND h.team_id IS NOT NULL
          AND a.team_id IS NOT NULL
          AND h.team_id = a.team_id
      ) THEN
        RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
      END IF;
    ELSIF NOT COALESCE(v_room.allow_bots, false) THEN
      RAISE EXCEPTION 'NEED_OPPONENT' USING ERRCODE = 'P0001';
    END IF;
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

-- room_recompute_status: already handles any player_count with ready==configured
-- Keep Fase 1 one-human + bots path; multi-human uses else branch (ready_count = count)

REVOKE ALL ON FUNCTION public.claim_room_seat(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_room_seat_auth(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.room_side_player_count(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.room_find_free_seat(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_room_seat(uuid, uuid, text, integer) TO project_admin;
GRANT EXECUTE ON FUNCTION public.claim_room_seat_auth(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.room_side_player_count(uuid, text) TO project_admin;
GRANT EXECUTE ON FUNCTION public.room_find_free_seat(uuid) TO project_admin;

COMMENT ON FUNCTION public.claim_room_seat_auth(uuid, text, integer) IS
  'Claim or switch a lobby seat (side + field_slot 0–3). Max 2 humans per side, 4 total.';
