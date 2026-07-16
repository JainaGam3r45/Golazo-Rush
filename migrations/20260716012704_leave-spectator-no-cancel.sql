-- Spectators leaving must not cancel the room (Fase 1 spectator scaffolding)

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
      AND left_at IS NULL
      AND role = 'player';

    PERFORM public.room_recompute_status(p_room_id);
  END IF;

  RETURN public.room_snapshot(p_room_id);
END;
$$;
