-- Client-facing private-room RPCs: identity from auth.uid() only.
-- Existing admin RPCs (p_user_id) stay project_admin-only for game-server / edge.
-- Match finalization and ranking writes remain inaccessible to authenticated.

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.create_private_room(v_uid, p_team_id, p_formation_id, p_duration_seconds);
END;
$$;

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.join_private_room(v_uid, p_code, p_team_id, p_formation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_private_room_auth(p_room_id uuid)
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
  RETURN public.leave_private_room(v_uid, p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_room_loadout_auth(
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
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.update_room_loadout(v_uid, p_room_id, p_team_id, p_formation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_room_ready_auth(
  p_room_id uuid,
  p_ready boolean
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
  RETURN public.set_room_ready(v_uid, p_room_id, p_ready);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_private_room_auth(p_room_id uuid)
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
  RETURN public.start_private_room(v_uid, p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_room_chat_auth(
  p_room_id uuid,
  p_body text
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
  RETURN public.publish_room_chat(v_uid, p_room_id, p_body);
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_room_presence_auth(p_room_id uuid)
RETURNS void
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
  PERFORM public.touch_room_presence(v_uid, p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_private_room_auth(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.get_private_room(v_uid, p_room_id);
END;
$$;

-- Client entry points: authenticated only. Never grant admin (p_user_id) RPCs here.
REVOKE ALL ON FUNCTION public.create_private_room_auth(text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_private_room_auth(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_private_room_auth(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_room_loadout_auth(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_room_ready_auth(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_private_room_auth(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_room_chat_auth(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_room_presence_auth(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_private_room_auth(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_private_room_auth(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_private_room_auth(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_private_room_auth(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_room_loadout_auth(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_ready_auth(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_private_room_auth(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_room_chat_auth(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_room_presence_auth(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_room_auth(uuid) TO authenticated;

-- Re-assert admin surface: p_user_id RPCs stay project_admin only.
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

COMMENT ON FUNCTION public.create_private_room_auth(text, text, integer) IS
  'Client RPC: creates a private room as auth.uid(). No user id param. Rate limit residual: spam create.';
COMMENT ON FUNCTION public.publish_room_chat_auth(uuid, text) IS
  'Client RPC: membership + length + last_chat_at rate limit, then realtime.publish.';
