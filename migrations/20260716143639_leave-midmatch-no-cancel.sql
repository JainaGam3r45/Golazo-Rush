-- Mid-match leave: mark only the leaver; cancel room only when 0 active players remain.
-- Spectators remain exempt. Lobby host leave / empty room still cancels.

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
  v_role text;
  v_is_host boolean;
  v_remaining integer;
  v_new_host uuid;
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

  SELECT p.role INTO v_role
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.user_id = p_user_id
    AND p.left_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.room_snapshot(p_room_id);
  END IF;

  UPDATE public.match_room_players
  SET left_at = now(), ready = false, last_seen_at = now()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND left_at IS NULL;

  -- Spectators are read-only members; leaving only removes their membership.
  IF v_role = 'spectator' THEN
    RETURN public.room_snapshot(p_room_id);
  END IF;

  v_is_host := v_room.host_user_id = p_user_id;
  SELECT public.room_active_player_count(p_room_id) INTO v_remaining;

  -- Mid-match: forfeit seat only; cancel solely when nobody remains.
  IF v_room.status IN ('starting', 'playing') THEN
    IF v_remaining = 0 THEN
      UPDATE public.match_room_players
      SET left_at = COALESCE(left_at, now()), ready = false
      WHERE room_id = p_room_id
        AND left_at IS NULL;

      UPDATE public.match_rooms
      SET status = 'cancelled', updated_at = now()
      WHERE id = p_room_id
        AND status NOT IN ('finished', 'cancelled');
    ELSIF v_is_host THEN
      SELECT p.user_id INTO v_new_host
      FROM public.match_room_players p
      WHERE p.room_id = p_room_id
        AND p.left_at IS NULL
        AND COALESCE(p.role, 'player') = 'player'
      ORDER BY p.joined_at ASC NULLS LAST
      LIMIT 1;

      IF v_new_host IS NOT NULL THEN
        UPDATE public.match_rooms
        SET host_user_id = v_new_host, updated_at = now()
        WHERE id = p_room_id;
      END IF;
    END IF;

    RETURN public.room_snapshot(p_room_id);
  END IF;

  -- Lobby: host leave or empty room cancels; otherwise recompute status.
  IF v_is_host OR v_remaining = 0 THEN
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
      AND left_at IS NULL
      AND role = 'player';

    PERFORM public.room_recompute_status(p_room_id);
  END IF;

  RETURN public.room_snapshot(p_room_id);
END;
$$;
