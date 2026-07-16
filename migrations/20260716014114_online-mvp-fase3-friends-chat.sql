-- Fase 3: friendships graph, persistent room chat, friend DMs.
-- Client path: authenticated *_auth RPCs (auth.uid()). Prefer RPC over edge.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_norm_active
  ON public.friendships (
    LEAST(requester_id, addressee_id),
    GREATEST(requester_id, addressee_id)
  )
  WHERE status IN ('pending', 'accepted', 'blocked');

CREATE INDEX IF NOT EXISTS friendships_requester_idx ON public.friendships (requester_id, status);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON public.friendships (addressee_id, status);

DROP TRIGGER IF EXISTS friendships_updated_at ON public.friendships;
CREATE TRIGGER friendships_updated_at
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

CREATE TABLE IF NOT EXISTS public.room_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.match_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS room_chat_messages_room_created_idx
  ON public.room_chat_messages (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_messages_no_self CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS direct_messages_pair_created_idx
  ON public.direct_messages (
    LEAST(sender_id, recipient_id),
    GREATEST(sender_id, recipient_id),
    created_at DESC
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.are_accepted_friends(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.status = 'accepted'
      AND (
        (f.requester_id = p_a AND f.addressee_id = p_b)
        OR (f.requester_id = p_b AND f.addressee_id = p_a)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.friendship_involves(p_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.id = p_id
      AND (f.requester_id = p_user_id OR f.addressee_id = p_user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.room_chat_history(p_room_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_json ORDER BY created_at), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      m.created_at,
      jsonb_build_object(
        'id', m.id,
        'roomId', m.room_id,
        'userId', m.user_id,
        'body', m.body,
        'createdAt', m.created_at,
        'displayName', pr.display_name,
        'username', pr.username
      ) AS row_json
    FROM (
      SELECT *
      FROM public.room_chat_messages
      WHERE room_id = p_room_id
      ORDER BY created_at DESC
      LIMIT v_limit
    ) m
    LEFT JOIN public.profiles pr ON pr.id = m.user_id
    ORDER BY m.created_at ASC
  ) ordered;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- room_snapshot + publish_room_chat (history + displayName)
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
    'players', v_players,
    'chatHistory', public.room_chat_history(p_room_id, 50)
  );
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
  v_msg_id uuid;
  v_created timestamptz;
  v_display text;
  v_username text;
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

  INSERT INTO public.room_chat_messages (room_id, user_id, body)
  VALUES (p_room_id, p_user_id, v_clean)
  RETURNING id, created_at INTO v_msg_id, v_created;

  SELECT pr.display_name, pr.username
  INTO v_display, v_username
  FROM public.profiles pr
  WHERE pr.id = p_user_id;

  v_payload := jsonb_build_object(
    'id', v_msg_id,
    'roomId', p_room_id,
    'userId', p_user_id,
    'body', v_clean,
    'createdAt', v_created,
    'displayName', v_display,
    'username', v_username
  );

  PERFORM realtime.publish(
    'room:' || p_room_id::text,
    'room_chat_message',
    v_payload
  );

  RETURN v_payload;
END;
$$;

-- ---------------------------------------------------------------------------
-- Friends RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_friend_request(
  p_user_id uuid,
  p_target text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_target_id uuid;
  v_raw text := trim(p_target);
  v_row public.friendships%ROWTYPE;
  v_pr record;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  IF v_raw IS NULL OR length(v_raw) = 0 THEN
    RAISE EXCEPTION 'INVALID_TARGET' USING ERRCODE = 'P0001';
  END IF;

  IF v_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_target_id := v_raw::uuid;
  ELSE
    SELECT pr.id INTO v_target_id
    FROM public.profiles pr
    WHERE lower(pr.username) = lower(v_raw)
       OR lower(pr.display_name) = lower(v_raw)
    ORDER BY CASE WHEN lower(pr.username) = lower(v_raw) THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_target_id = p_user_id THEN
    RAISE EXCEPTION 'CANNOT_FRIEND_SELF' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.status = 'blocked'
      AND (
        (f.requester_id = p_user_id AND f.addressee_id = v_target_id)
        OR (f.requester_id = v_target_id AND f.addressee_id = p_user_id)
      )
  ) THEN
    RAISE EXCEPTION 'BLOCKED' USING ERRCODE = 'P0001';
  END IF;

  IF public.are_accepted_friends(p_user_id, v_target_id) THEN
    RAISE EXCEPTION 'ALREADY_FRIENDS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.friendships f
  WHERE f.status = 'pending'
    AND (
      (f.requester_id = p_user_id AND f.addressee_id = v_target_id)
      OR (f.requester_id = v_target_id AND f.addressee_id = p_user_id)
    )
  LIMIT 1;

  IF FOUND THEN
    IF v_row.requester_id = v_target_id AND v_row.addressee_id = p_user_id THEN
      UPDATE public.friendships
      SET status = 'accepted', updated_at = now()
      WHERE id = v_row.id
      RETURNING * INTO v_row;
    END IF;
  ELSE
    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (p_user_id, v_target_id, 'pending')
    RETURNING * INTO v_row;
  END IF;

  SELECT pr.id, pr.username, pr.display_name
  INTO v_pr
  FROM public.profiles pr
  WHERE pr.id = v_target_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'requesterId', v_row.requester_id,
    'addresseeId', v_row.addressee_id,
    'status', v_row.status,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'peer', jsonb_build_object(
      'userId', v_target_id,
      'username', v_pr.username,
      'displayName', v_pr.display_name
    )
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_FRIENDS' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_friend_request(
  p_user_id uuid,
  p_friendship_id uuid,
  p_accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.friendships%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.friendships
  WHERE id = p_friendship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.addressee_id <> p_user_id THEN
    RAISE EXCEPTION 'NOT_ADDRESSEE' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_NOT_PENDING' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.friendships
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      updated_at = now()
  WHERE id = p_friendship_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'requesterId', v_row.requester_id,
    'addresseeId', v_row.addressee_id,
    'status', v_row.status,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friendship(
  p_user_id uuid,
  p_friendship_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.friendships%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.friendships
  WHERE id = p_friendship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.requester_id <> p_user_id AND v_row.addressee_id <> p_user_id THEN
    RAISE EXCEPTION 'NOT_A_PARTY' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.friendships WHERE id = p_friendship_id;

  RETURN jsonb_build_object('ok', true, 'id', p_friendship_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.block_user(
  p_user_id uuid,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.friendships%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  IF p_target_id IS NULL OR p_target_id = p_user_id THEN
    RAISE EXCEPTION 'INVALID_TARGET' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.friendships
  WHERE (
    (requester_id = p_user_id AND addressee_id = p_target_id)
    OR (requester_id = p_target_id AND addressee_id = p_user_id)
  );

  INSERT INTO public.friendships (requester_id, addressee_id, status)
  VALUES (p_user_id, p_target_id, 'blocked')
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'requesterId', v_row.requester_id,
    'addresseeId', v_row.addressee_id,
    'status', v_row.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_friends(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_friends jsonb;
  v_incoming jsonb;
  v_outgoing jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'friendshipId', f.id,
      'userId', CASE WHEN f.requester_id = p_user_id THEN f.addressee_id ELSE f.requester_id END,
      'username', pr.username,
      'displayName', pr.display_name,
      'since', f.updated_at
    )
    ORDER BY COALESCE(pr.display_name, pr.username, f.id::text)
  ), '[]'::jsonb)
  INTO v_friends
  FROM public.friendships f
  JOIN public.profiles pr ON pr.id = CASE
    WHEN f.requester_id = p_user_id THEN f.addressee_id
    ELSE f.requester_id
  END
  WHERE f.status = 'accepted'
    AND (f.requester_id = p_user_id OR f.addressee_id = p_user_id);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'friendshipId', f.id,
      'userId', f.requester_id,
      'username', pr.username,
      'displayName', pr.display_name,
      'createdAt', f.created_at
    )
    ORDER BY f.created_at DESC
  ), '[]'::jsonb)
  INTO v_incoming
  FROM public.friendships f
  JOIN public.profiles pr ON pr.id = f.requester_id
  WHERE f.status = 'pending'
    AND f.addressee_id = p_user_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'friendshipId', f.id,
      'userId', f.addressee_id,
      'username', pr.username,
      'displayName', pr.display_name,
      'createdAt', f.created_at
    )
    ORDER BY f.created_at DESC
  ), '[]'::jsonb)
  INTO v_outgoing
  FROM public.friendships f
  JOIN public.profiles pr ON pr.id = f.addressee_id
  WHERE f.status = 'pending'
    AND f.requester_id = p_user_id;

  RETURN jsonb_build_object(
    'friends', COALESCE(v_friends, '[]'::jsonb),
    'incoming', COALESCE(v_incoming, '[]'::jsonb),
    'outgoing', COALESCE(v_outgoing, '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Direct messages
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_direct_message(
  p_user_id uuid,
  p_recipient_id uuid,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_clean text;
  v_row public.direct_messages%ROWTYPE;
  v_display text;
  v_username text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = p_user_id THEN
    RAISE EXCEPTION 'INVALID_TARGET' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.are_accepted_friends(p_user_id, p_recipient_id) THEN
    RAISE EXCEPTION 'NOT_FRIENDS' USING ERRCODE = 'P0001';
  END IF;

  v_clean := trim(p_body);
  IF v_clean IS NULL OR length(v_clean) = 0 THEN
    RAISE EXCEPTION 'EMPTY_MESSAGE' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_clean) > 500 THEN
    RAISE EXCEPTION 'MESSAGE_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;
  v_clean := regexp_replace(v_clean, '[<>]', '', 'g');

  INSERT INTO public.direct_messages (sender_id, recipient_id, body)
  VALUES (p_user_id, p_recipient_id, v_clean)
  RETURNING * INTO v_row;

  SELECT pr.display_name, pr.username
  INTO v_display, v_username
  FROM public.profiles pr
  WHERE pr.id = p_user_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'senderId', v_row.sender_id,
    'recipientId', v_row.recipient_id,
    'body', v_row.body,
    'createdAt', v_row.created_at,
    'displayName', v_display,
    'username', v_username
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_direct_messages(
  p_user_id uuid,
  p_peer_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_rows jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  IF p_peer_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TARGET' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.are_accepted_friends(p_user_id, p_peer_id) THEN
    RAISE EXCEPTION 'NOT_FRIENDS' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(row_json ORDER BY created_at), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      m.created_at,
      jsonb_build_object(
        'id', m.id,
        'senderId', m.sender_id,
        'recipientId', m.recipient_id,
        'body', m.body,
        'createdAt', m.created_at,
        'displayName', pr.display_name,
        'username', pr.username
      ) AS row_json
    FROM (
      SELECT *
      FROM public.direct_messages d
      WHERE (d.sender_id = p_user_id AND d.recipient_id = p_peer_id)
         OR (d.sender_id = p_peer_id AND d.recipient_id = p_user_id)
      ORDER BY d.created_at DESC
      LIMIT v_limit
    ) m
    LEFT JOIN public.profiles pr ON pr.id = m.sender_id
    ORDER BY m.created_at ASC
  ) ordered;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Auth wrappers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_friend_request_auth(p_target text)
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
  RETURN public.send_friend_request(v_uid, p_target);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_friend_request_auth(
  p_friendship_id uuid,
  p_accept boolean
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
  RETURN public.respond_friend_request(v_uid, p_friendship_id, p_accept);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friendship_auth(p_friendship_id uuid)
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
  RETURN public.remove_friendship(v_uid, p_friendship_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.block_user_auth(p_target_id uuid)
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
  RETURN public.block_user(v_uid, p_target_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_friends_auth()
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
  RETURN public.list_friends(v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.send_direct_message_auth(
  p_recipient_id uuid,
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
  RETURN public.send_direct_message(v_uid, p_recipient_id, p_body);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_direct_messages_auth(
  p_peer_id uuid,
  p_limit integer DEFAULT 50
)
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
  RETURN public.list_direct_messages(v_uid, p_peer_id, p_limit);
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS friendships_select_own ON public.friendships;
CREATE POLICY friendships_select_own ON public.friendships
  FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS room_chat_messages_member_select ON public.room_chat_messages;
CREATE POLICY room_chat_messages_member_select ON public.room_chat_messages
  FOR SELECT TO authenticated
  USING (public.is_room_member(room_id));

DROP POLICY IF EXISTS direct_messages_friends_select ON public.direct_messages;
CREATE POLICY direct_messages_friends_select ON public.direct_messages
  FOR SELECT TO authenticated
  USING (
    (sender_id = (SELECT auth.uid()) OR recipient_id = (SELECT auth.uid()))
    AND public.are_accepted_friends(sender_id, recipient_id)
  );

REVOKE ALL ON TABLE public.friendships FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_chat_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.direct_messages FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.friendships TO authenticated;
GRANT SELECT ON TABLE public.room_chat_messages TO authenticated;
GRANT SELECT ON TABLE public.direct_messages TO authenticated;

REVOKE ALL ON FUNCTION public.are_accepted_friends(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.friendship_involves(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.room_chat_history(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_friend_request(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.respond_friend_request(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_friendship(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_friends(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_direct_message(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_direct_messages(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.are_accepted_friends(uuid, uuid) TO authenticated, project_admin;
GRANT EXECUTE ON FUNCTION public.friendship_involves(uuid, uuid) TO authenticated, project_admin;
GRANT EXECUTE ON FUNCTION public.room_chat_history(uuid, integer) TO project_admin;
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid, text) TO project_admin;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, uuid, boolean) TO project_admin;
GRANT EXECUTE ON FUNCTION public.remove_friendship(uuid, uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.block_user(uuid, uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.list_friends(uuid) TO project_admin;
GRANT EXECUTE ON FUNCTION public.send_direct_message(uuid, uuid, text) TO project_admin;
GRANT EXECUTE ON FUNCTION public.list_direct_messages(uuid, uuid, integer) TO project_admin;

REVOKE ALL ON FUNCTION public.send_friend_request_auth(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_friend_request_auth(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_friendship_auth(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.block_user_auth(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_friends_auth() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_direct_message_auth(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_direct_messages_auth(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.send_friend_request_auth(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request_auth(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_friendship_auth(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_user_auth(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_friends_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_direct_message_auth(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_direct_messages_auth(uuid, integer) TO authenticated;

COMMENT ON TABLE public.friendships IS 'Friend request / accept / decline / block graph';
COMMENT ON TABLE public.room_chat_messages IS 'Persisted room lobby chat; returned in room_snapshot.chatHistory';
COMMENT ON TABLE public.direct_messages IS 'DMs between accepted friends only';
