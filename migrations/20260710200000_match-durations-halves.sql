-- Match durations: 10 / 15 / 30 / 45 minutes (600 / 900 / 1800 / 2700 seconds)

ALTER TABLE public.match_rooms
  DROP CONSTRAINT IF EXISTS match_rooms_duration_seconds_check;

UPDATE public.match_rooms
SET duration_seconds = CASE duration_seconds
  WHEN 60 THEN 600
  WHEN 120 THEN 900
  WHEN 180 THEN 1800
  ELSE duration_seconds
END
WHERE duration_seconds IN (60, 120, 180);

ALTER TABLE public.match_rooms
  ALTER COLUMN duration_seconds SET DEFAULT 900;

ALTER TABLE public.match_rooms
  ADD CONSTRAINT match_rooms_duration_seconds_check
  CHECK (duration_seconds IN (600, 900, 1800, 2700));

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

CREATE OR REPLACE FUNCTION public.create_private_room_auth(
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
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.create_private_room(v_uid, p_team_id, p_formation_id, p_duration_seconds);
END;
$$;
