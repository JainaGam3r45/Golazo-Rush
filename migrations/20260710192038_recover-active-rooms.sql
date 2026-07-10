-- Active room recovery for abandoned tabs / stale memberships.
-- Identity from auth.uid() only. TTL: waiting/configuring/ready = 8 minutes without last_seen.

CREATE OR REPLACE FUNCTION public.release_stale_active_membership(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_room public.match_rooms%ROWTYPE;
  v_player public.match_room_players%ROWTYPE;
  v_stale_lobby interval := interval '8 minutes';
BEGIN
  SELECT p.* INTO v_player
  FROM public.match_room_players p
  WHERE p.user_id = p_user_id
    AND p.left_at IS NULL
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT r.* INTO v_room
  FROM public.match_rooms r
  WHERE r.id = v_player.room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.match_room_players
    SET left_at = now(), ready = false
    WHERE id = v_player.id AND left_at IS NULL;
    RETURN NULL;
  END IF;

  -- Finished / cancelled / expired → always release
  IF v_room.status IN ('finished', 'cancelled')
     OR v_room.expires_at < now() THEN
    UPDATE public.match_room_players
    SET left_at = COALESCE(left_at, now()), ready = false
    WHERE room_id = v_room.id AND left_at IS NULL;

    IF v_room.status NOT IN ('finished', 'cancelled') THEN
      UPDATE public.match_rooms
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_room.id;
    END IF;
    RETURN NULL;
  END IF;

  -- Lobby states: release if last_seen is stale
  IF v_room.status IN ('waiting', 'configuring', 'ready') THEN
    IF v_player.last_seen_at < now() - v_stale_lobby THEN
      PERFORM public.leave_private_room(p_user_id, v_room.id);
      RETURN NULL;
    END IF;
  END IF;

  -- starting / playing: keep membership for reconnect
  RETURN v_room.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_room_auth()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  v_room_id := public.release_stale_active_membership(v_uid);
  IF v_room_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.room_snapshot(v_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_active_room_auth()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  v_room_id := public.release_stale_active_membership(v_uid);
  IF v_room_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.match_room_players
  SET last_seen_at = now()
  WHERE room_id = v_room_id
    AND user_id = v_uid
    AND left_at IS NULL;

  RETURN public.room_snapshot(v_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_active_room_auth()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.room_id INTO v_room_id
  FROM public.match_room_players p
  WHERE p.user_id = v_uid
    AND p.left_at IS NULL
  LIMIT 1;

  IF v_room_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.leave_private_room(v_uid, v_room_id);
END;
$$;

-- Create: if still in a valid active room after recovery, return that room (resume)
CREATE OR REPLACE FUNCTION public.create_private_room_auth(
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
  v_uid uuid := auth.uid();
  v_existing jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  v_existing := public.recover_active_room_auth();
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  RETURN public.create_private_room(v_uid, p_team_id, p_formation_id, p_duration_seconds);
END;
$$;

-- Join: same-code resume; otherwise recover then try join
CREATE OR REPLACE FUNCTION public.join_private_room_auth(
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
  v_uid uuid := auth.uid();
  v_existing jsonb;
  v_code text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  v_existing := public.recover_active_room_auth();
  IF v_existing IS NOT NULL THEN
    v_code := upper(trim(p_code));
    IF (v_existing->>'code') = v_code THEN
      RETURN v_existing;
    END IF;
    RAISE EXCEPTION 'ALREADY_IN_ROOM' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.join_private_room(v_uid, p_code, p_team_id, p_formation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_active_membership(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_room_auth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_active_room_auth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_active_room_auth() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_active_room_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recover_active_room_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_active_room_auth() TO authenticated;
