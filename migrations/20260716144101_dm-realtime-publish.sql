-- Publish direct messages over realtime so open DM panels update live.
-- Channel: dm:{min(userId,peerId)}:{max(userId,peerId)}

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
  v_payload jsonb;
  v_channel text;
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

  v_payload := jsonb_build_object(
    'id', v_row.id,
    'senderId', v_row.sender_id,
    'recipientId', v_row.recipient_id,
    'body', v_row.body,
    'createdAt', v_row.created_at,
    'displayName', v_display,
    'username', v_username
  );

  v_channel :=
    'dm:'
    || LEAST(p_user_id, p_recipient_id)::text
    || ':'
    || GREATEST(p_user_id, p_recipient_id)::text;

  PERFORM realtime.publish(v_channel, 'direct_message', v_payload);

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.send_direct_message(uuid, uuid, text) IS
  'Insert DM between accepted friends and publish to dm:{min}:{max} realtime channel.';
