-- Custom 11v11 lineups for private rooms + default format 11v11.

ALTER TABLE public.match_rooms
  ALTER COLUMN format_id SET DEFAULT '11v11';

UPDATE public.match_rooms
SET format_id = '11v11'
WHERE format_id = '5v5' AND status IN ('waiting', 'configuring', 'ready');

ALTER TABLE public.match_room_players
  ADD COLUMN IF NOT EXISTS lineup jsonb;

COMMENT ON COLUMN public.match_room_players.lineup IS
  'Custom 10-outfield lineup [{nx,ny,role}] for 11v11; null uses default template.';

DROP FUNCTION IF EXISTS public.update_room_loadout_auth(uuid, text, text);
DROP FUNCTION IF EXISTS public.update_room_loadout(uuid, uuid, text, text);

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
      'lineup', p.lineup,
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
  WHERE room_id = p_room_id AND user_id = p_user_id AND left_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  IF p_formation_id IS NOT NULL AND p_formation_id NOT IN ('4-3-3', '4-4-2', '3-5-2', '4-2-3-1') THEN
    RAISE EXCEPTION 'INVALID_FORMATION' USING ERRCODE = 'P0001';
  END IF;

  IF p_lineup IS NOT NULL AND jsonb_typeof(p_lineup) = 'array' AND jsonb_array_length(p_lineup) <> 10 THEN
    RAISE EXCEPTION 'INVALID_FORMATION' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.match_room_players
      WHERE room_id = p_room_id
        AND left_at IS NULL
        AND user_id <> p_user_id
        AND team_id = p_team_id
    ) THEN
      RAISE EXCEPTION 'TEAM_TAKEN' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.match_room_players
  SET
    team_id = COALESCE(p_team_id, team_id),
    formation_id = COALESCE(p_formation_id, formation_id),
    lineup = COALESCE(p_lineup, lineup),
    ready = false,
    last_seen_at = now()
  WHERE id = v_player.id;

  IF v_room.status = 'ready' THEN
    UPDATE public.match_rooms SET status = 'configuring', updated_at = now() WHERE id = v_room.id;
  ELSE
    UPDATE public.match_rooms SET updated_at = now() WHERE id = v_room.id;
  END IF;

  PERFORM realtime.publish(('room:' || p_room_id::text), 'room_updated', public.room_snapshot(p_room_id));
  RETURN public.room_snapshot(p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_room_loadout_auth(
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
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.update_room_loadout(v_uid, p_room_id, p_team_id, p_formation_id, p_lineup);
END;
$$;

-- Recreate create to force format 11v11
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

  IF p_duration_seconds NOT IN (60, 120, 180) THEN
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
        room_id, user_id, slot, team_id, formation_id, ready
      ) VALUES (
        v_room_id, p_user_id, 'home', p_team_id, p_formation_id, false
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

REVOKE ALL ON FUNCTION public.update_room_loadout(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_room_loadout_auth(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_room_loadout(uuid, uuid, text, text, jsonb) TO project_admin;
GRANT EXECUTE ON FUNCTION public.update_room_loadout_auth(uuid, text, text, jsonb) TO authenticated;
