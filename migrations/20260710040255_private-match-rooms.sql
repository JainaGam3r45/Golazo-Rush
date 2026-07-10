-- Private 1v1 match rooms (Phase A: lobby only, no authoritative match server)

CREATE TABLE public.match_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN (
      'waiting',
      'configuring',
      'ready',
      'starting',
      'playing',
      'finished',
      'cancelled'
    )),
  format_id text NOT NULL DEFAULT '5v5',
  duration_seconds integer NOT NULL DEFAULT 180
    CHECK (duration_seconds IN (60, 120, 180)),
  match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_rooms_code_format CHECK (code ~ '^[A-Z2-9]{6}$')
);

CREATE UNIQUE INDEX match_rooms_code_uidx ON public.match_rooms (code);
CREATE INDEX match_rooms_status_idx ON public.match_rooms (status);
CREATE INDEX match_rooms_expires_at_idx ON public.match_rooms (expires_at);
CREATE INDEX match_rooms_host_user_id_idx ON public.match_rooms (host_user_id);

CREATE TABLE public.match_room_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.match_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('home', 'away')),
  team_id text REFERENCES public.teams(id) ON DELETE SET NULL,
  formation_id text NOT NULL DEFAULT '4-4-2'
    CHECK (formation_id IN ('4-3-3', '4-4-2', '3-5-2', '4-2-3-1')),
  ready boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_chat_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  CONSTRAINT match_room_players_room_user_uidx UNIQUE (room_id, user_id)
);

CREATE UNIQUE INDEX match_room_players_one_active_uidx
  ON public.match_room_players (user_id)
  WHERE left_at IS NULL;

CREATE UNIQUE INDEX match_room_players_active_slot_uidx
  ON public.match_room_players (room_id, slot)
  WHERE left_at IS NULL;

CREATE INDEX match_room_players_room_id_idx ON public.match_room_players (room_id);
CREATE INDEX match_room_players_user_id_idx ON public.match_room_players (user_id);

CREATE TRIGGER match_rooms_updated_at
  BEFORE UPDATE ON public.match_rooms
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

-- Realtime channel for private rooms
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('room:%', 'Coordinación de salas privadas 1v1', true)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;

-- Helpers
CREATE OR REPLACE FUNCTION public.is_room_member(p_room_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_room_players p
    WHERE p.room_id = p_room_id
      AND p.user_id = p_user_id
      AND p.left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.generate_room_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i integer;
BEGIN
  FOR i IN 1..24 LOOP
    candidate := '';
    WHILE length(candidate) < 6 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.match_rooms r WHERE r.code = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'ROOM_CODE_COLLISION' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.room_active_player_count(p_room_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.room_recompute_status(p_room_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status text;
  v_count integer;
  v_ready_count integer;
  v_configured_count integer;
  v_new_status text;
BEGIN
  SELECT r.status INTO v_status
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

  IF v_count = 1 THEN
    v_new_status := 'waiting';
  ELSE
    SELECT
      COUNT(*) FILTER (
        WHERE p.team_id IS NOT NULL
          AND p.formation_id IS NOT NULL
      ),
      COUNT(*) FILTER (WHERE p.ready)
    INTO v_configured_count, v_ready_count
    FROM public.match_room_players p
    WHERE p.room_id = p_room_id
      AND p.left_at IS NULL;

    IF v_ready_count = 2 AND v_configured_count = 2 THEN
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
      'teamId', p.team_id,
      'formationId', p.formation_id,
      'ready', p.ready,
      'joinedAt', p.joined_at,
      'lastSeenAt', p.last_seen_at,
      'displayName', pr.display_name,
      'username', pr.username
    )
    ORDER BY CASE p.slot WHEN 'home' THEN 0 ELSE 1 END
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
    'matchId', v_room.match_id,
    'expiresAt', v_room.expires_at,
    'createdAt', v_room.created_at,
    'updatedAt', v_room.updated_at,
    'players', v_players
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_room_updated()
RETURNS TRIGGER AS $$
DECLARE
  v_room_id uuid;
  v_snapshot jsonb;
BEGIN
  IF TG_TABLE_NAME = 'match_rooms' THEN
    v_room_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_room_id := COALESCE(NEW.room_id, OLD.room_id);
  END IF;

  v_snapshot := public.room_snapshot(v_room_id);
  IF v_snapshot IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM realtime.publish(
    'room:' || v_room_id::text,
    'room_updated',
    v_snapshot
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE TRIGGER match_rooms_realtime_trigger
AFTER INSERT OR UPDATE ON public.match_rooms
FOR EACH ROW
EXECUTE FUNCTION public.notify_room_updated();

CREATE TRIGGER match_room_players_realtime_trigger
AFTER INSERT OR UPDATE ON public.match_room_players
FOR EACH ROW
EXECUTE FUNCTION public.notify_room_updated();

-- Atomic RPCs (callable by project_admin via edge functions after session check)
CREATE OR REPLACE FUNCTION public.create_private_room(
  p_user_id uuid,
  p_team_id text,
  p_formation_id text DEFAULT '4-4-2',
  p_duration_seconds integer DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_code text;
  v_room_id uuid;
  v_attempt integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF p_duration_seconds NOT IN (60, 120, 180) THEN
    RAISE EXCEPTION 'INVALID_DURATION' USING ERRCODE = 'P0001';
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

  FOR v_attempt IN 1..8 LOOP
    BEGIN
      v_code := public.generate_room_code();
      INSERT INTO public.match_rooms (code, host_user_id, status, duration_seconds)
      VALUES (v_code, p_user_id, 'waiting', p_duration_seconds)
      RETURNING id INTO v_room_id;

      INSERT INTO public.match_room_players (
        room_id, user_id, slot, team_id, formation_id, ready
      ) VALUES (
        v_room_id, p_user_id, 'home', p_team_id, p_formation_id, false
      );

      RETURN public.room_snapshot(v_room_id);
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempt = 8 THEN
          RAISE EXCEPTION 'ROOM_CODE_COLLISION' USING ERRCODE = 'P0001';
        END IF;
    END;
  END LOOP;

  RAISE EXCEPTION 'ROOM_CREATE_FAILED' USING ERRCODE = 'P0001';
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
      AND p.team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.match_room_players (
    room_id, user_id, slot, team_id, formation_id, ready
  ) VALUES (
    v_room.id, p_user_id, 'away', p_team_id, p_formation_id, false
  );

  PERFORM public.room_recompute_status(v_room.id);
  RETURN public.room_snapshot(v_room.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_private_room(
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
  v_is_host boolean;
  v_remaining integer;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.match_room_players p
    WHERE p.room_id = p_room_id
      AND p.user_id = p_user_id
      AND p.left_at IS NULL
  ) THEN
    RETURN public.room_snapshot(p_room_id);
  END IF;

  UPDATE public.match_room_players
  SET left_at = now(), ready = false, last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL;

  v_is_host := v_room.host_user_id = p_user_id;
  SELECT public.room_active_player_count(p_room_id) INTO v_remaining;

  IF v_is_host OR v_remaining = 0 OR v_room.status IN ('starting', 'playing', 'ready') THEN
    UPDATE public.match_room_players
    SET left_at = COALESCE(left_at, now()), ready = false
    WHERE room_id = p_room_id
      AND left_at IS NULL;

    UPDATE public.match_rooms
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_room_id
      AND status NOT IN ('finished', 'cancelled');
  ELSE
    UPDATE public.match_room_players
    SET ready = false
    WHERE room_id = p_room_id
      AND left_at IS NULL;

    PERFORM public.room_recompute_status(p_room_id);
  END IF;

  RETURN public.room_snapshot(p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_room_loadout(
  p_user_id uuid,
  p_room_id uuid,
  p_team_id text DEFAULT NULL,
  p_formation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_other_team text;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.match_room_players p
    WHERE p.room_id = p_room_id AND p.user_id = p_user_id AND p.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_team_id) THEN
      RAISE EXCEPTION 'INVALID_TEAM' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.team_id INTO v_other_team
    FROM public.match_room_players p
    WHERE p.room_id = p_room_id
      AND p.user_id <> p_user_id
      AND p.left_at IS NULL
    LIMIT 1;

    IF v_other_team IS NOT NULL AND v_other_team = p_team_id THEN
      RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_formation_id IS NOT NULL AND p_formation_id NOT IN ('4-3-3', '4-4-2', '3-5-2', '4-2-3-1') THEN
    RAISE EXCEPTION 'INVALID_FORMATION' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_room_players
  SET
    team_id = COALESCE(p_team_id, team_id),
    formation_id = COALESCE(p_formation_id, formation_id),
    ready = false,
    last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL;

  -- Changing loadout clears ready for the actor; also clear opponent ready to force reconfirm
  UPDATE public.match_room_players
  SET ready = false
  WHERE room_id = p_room_id
    AND left_at IS NULL
    AND ready = true;

  PERFORM public.room_recompute_status(p_room_id);
  RETURN public.room_snapshot(p_room_id);
END;
$$;

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

  SELECT p.team_id, p.formation_id INTO v_team, v_formation
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.user_id = p_user_id
    AND p.left_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  IF p_ready THEN
    SELECT public.room_active_player_count(p_room_id) INTO v_count;
    IF v_count < 2 THEN
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
    LIMIT 1;

    IF v_other_team IS NOT NULL AND v_other_team = v_team THEN
      RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.match_room_players
  SET ready = p_ready, last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL;

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

  -- Idempotent: already starting/playing returns current snapshot
  IF v_room.status IN ('starting', 'playing') THEN
    RETURN public.room_snapshot(p_room_id);
  END IF;

  IF v_room.status <> 'ready' THEN
    RAISE EXCEPTION 'NOT_READY' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_room_member(p_room_id, p_user_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  -- Only host can trigger start in Phase A
  IF v_room.host_user_id <> p_user_id THEN
    RAISE EXCEPTION 'NOT_HOST' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE p.ready),
    COUNT(DISTINCT p.team_id)
  INTO v_ready_count, v_team_count
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL;

  IF v_ready_count <> 2 OR public.room_active_player_count(p_room_id) <> 2 THEN
    RAISE EXCEPTION 'NOT_READY' USING ERRCODE = 'P0001';
  END IF;

  IF v_team_count < 2 THEN
    RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_rooms
  SET status = 'starting', updated_at = now()
  WHERE id = p_room_id
    AND status = 'ready';

  IF NOT FOUND THEN
    -- Lost the race; if another request won, return idempotent snapshot
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
      'status', 'starting'
    )
  );

  RETURN public.room_snapshot(p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_room_chat(
  p_user_id uuid,
  p_room_id uuid,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_last timestamptz;
  v_clean text;
  v_payload jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_room FROM public.match_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_room.status IN ('cancelled', 'finished') THEN
    RAISE EXCEPTION 'ROOM_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_room_member(p_room_id, p_user_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  v_clean := trim(p_body);
  IF v_clean IS NULL OR length(v_clean) = 0 THEN
    RAISE EXCEPTION 'EMPTY_MESSAGE' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_clean) > 200 THEN
    RAISE EXCEPTION 'MESSAGE_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;
  -- Strip angle brackets to avoid HTML injection in clients that forget to escape
  v_clean := regexp_replace(v_clean, '[<>]', '', 'g');

  SELECT p.last_chat_at INTO v_last
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.user_id = p_user_id
    AND p.left_at IS NULL
  FOR UPDATE;

  IF v_last IS NOT NULL AND v_last > now() - interval '1 second' THEN
    RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_room_players
  SET last_chat_at = now(), last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL;

  v_payload := jsonb_build_object(
    'roomId', p_room_id,
    'userId', p_user_id,
    'body', v_clean,
    'createdAt', now()
  );

  PERFORM realtime.publish(
    'room:' || p_room_id::text,
    'room_chat_message',
    v_payload
  );

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_room_presence(
  p_user_id uuid,
  p_room_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.match_room_players
  SET last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_private_room(
  p_user_id uuid,
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_room_member(p_room_id, p_user_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.room_snapshot(p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.match_rooms
    WHERE status IN ('waiting', 'configuring', 'ready', 'starting')
      AND (
        expires_at < now()
        OR (
          status = 'waiting'
          AND updated_at < now() - interval '30 minutes'
        )
        OR (
          status = 'starting'
          AND updated_at < now() - interval '10 minutes'
        )
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.match_room_players
    SET left_at = COALESCE(left_at, now()), ready = false
    WHERE room_id = r.id
      AND left_at IS NULL;

    UPDATE public.match_rooms
    SET status = 'cancelled', updated_at = now()
    WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- RLS
ALTER TABLE public.match_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_room_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_rooms_member_select ON public.match_rooms
  FOR SELECT TO authenticated
  USING (public.is_room_member(id));

CREATE POLICY match_room_players_member_select ON public.match_room_players
  FOR SELECT TO authenticated
  USING (public.is_room_member(room_id));

REVOKE ALL ON public.match_rooms FROM anon, authenticated;
REVOKE ALL ON public.match_room_players FROM anon, authenticated;
GRANT SELECT ON public.match_rooms TO authenticated;
GRANT SELECT ON public.match_room_players TO authenticated;

REVOKE ALL ON FUNCTION public.create_private_room(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_private_room(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_private_room(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_room_loadout(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_ready(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_private_room(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_room_chat(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_room_presence(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_private_room(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_rooms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.room_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.room_recompute_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_room_code() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_room_member(uuid, uuid) TO authenticated, anon;

-- Realtime channel subscription restricted to room members (best-effort)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'channels'
      AND policyname = 'room_members_subscribe'
  ) THEN
    CREATE POLICY room_members_subscribe
    ON realtime.channels FOR SELECT
    TO authenticated
    USING (
      pattern = 'room:%'
      AND public.is_room_member(
        NULLIF(split_part(realtime.channel_name(), ':', 2), '')::uuid
      )
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping realtime.channels policy: %', SQLERRM;
END $$;
