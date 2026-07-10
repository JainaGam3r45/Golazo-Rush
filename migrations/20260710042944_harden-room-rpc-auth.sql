-- Harden Phase A room helpers: pin search_path, prevent forged userId on is_room_member,
-- and keep mutating RPCs executable only by project_admin.

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
      AND p.user_id = CASE
        -- Client roles may only check their own membership (ignore forged p_user_id).
        WHEN current_user IN ('anon', 'authenticated') THEN auth.uid()
        ELSE COALESCE(p_user_id, auth.uid())
      END
      AND p.left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.generate_room_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COUNT(*)::integer
  FROM public.match_room_players p
  WHERE p.room_id = p_room_id
    AND p.left_at IS NULL;
$$;

-- Re-assert EXECUTE surface: mutating / snapshot RPCs are edge-only (project_admin).
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
REVOKE ALL ON FUNCTION public.room_active_player_count(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_private_room(uuid, text, text, integer) TO project_admin;
GRANT EXECUTE ON FUNCTION public.join_private_room(uuid, text, text, text) TO project_admin;
GRANT EXECUTE ON FUNCTION public.leave_private_room(uuid, uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.update_room_loadout(uuid, uuid, text, text) TO project_admin;
GRANT EXECUTE ON FUNCTION public.set_room_ready(uuid, uuid, boolean) TO project_admin;
GRANT EXECUTE ON FUNCTION public.start_private_room(uuid, uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.publish_room_chat(uuid, uuid, text) TO project_admin;
GRANT EXECUTE ON FUNCTION public.touch_room_presence(uuid, uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.get_private_room(uuid, uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rooms() TO project_admin;
GRANT EXECUTE ON FUNCTION public.room_snapshot(uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.room_recompute_status(uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.generate_room_code() TO project_admin;
GRANT EXECUTE ON FUNCTION public.room_active_player_count(uuid) TO project_admin;

-- RLS / realtime membership helper: authenticated only (anon cannot probe rooms).
REVOKE ALL ON FUNCTION public.is_room_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_room_member(uuid, uuid) TO authenticated, project_admin;
