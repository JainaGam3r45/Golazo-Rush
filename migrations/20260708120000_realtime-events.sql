-- Realtime channel patterns and business-event triggers

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES
  ('global:presence', 'Presencia global de jugadores', true),
  ('match:%', 'Coordinación por partida', true)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;

CREATE OR REPLACE FUNCTION public.notify_ranking_updated()
RETURNS TRIGGER AS $$
DECLARE
  v_rank integer;
BEGIN
  SELECT COUNT(*) + 1 INTO v_rank
  FROM public.team_rankings
  WHERE points > NEW.points
     OR (points = NEW.points AND goals_for > NEW.goals_for);

  PERFORM realtime.publish(
    'global:ranking',
    'ranking_updated',
    jsonb_build_object(
      'teamId', NEW.team_id,
      'points', NEW.points,
      'wins', NEW.wins,
      'draws', NEW.draws,
      'losses', NEW.losses,
      'goalsFor', NEW.goals_for,
      'goalsAgainst', NEW.goals_against,
      'rank', v_rank
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER team_rankings_realtime_trigger
AFTER INSERT OR UPDATE ON public.team_rankings
FOR EACH ROW
EXECUTE FUNCTION public.notify_ranking_updated();

CREATE OR REPLACE FUNCTION public.notify_live_event_created()
RETURNS TRIGGER AS $$
DECLARE
  v_parts text[];
  v_opponent_id text;
  v_minute integer;
BEGIN
  v_parts := string_to_array(NEW.message, '|');
  v_opponent_id := COALESCE(v_parts[2], '');
  v_minute := COALESCE(NULLIF(v_parts[3], '')::integer, 0);

  PERFORM realtime.publish(
    'global:activity',
    'live_event_created',
    jsonb_build_object(
      'id', NEW.id,
      'type', NEW.type,
      'teamId', NEW.team_id,
      'opponentId', v_opponent_id,
      'minute', v_minute,
      'message', NEW.message,
      'createdAt', NEW.created_at
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER live_events_realtime_trigger
AFTER INSERT ON public.live_events
FOR EACH ROW
EXECUTE FUNCTION public.notify_live_event_created();

CREATE OR REPLACE FUNCTION public.notify_match_created()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'open' THEN
    PERFORM realtime.publish(
      'lobby:main',
      'match_created',
      jsonb_build_object(
        'matchId', NEW.id,
        'homeTeamId', NEW.home_team_id,
        'awayTeamId', NEW.away_team_id,
        'status', NEW.status
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER matches_created_realtime_trigger
AFTER INSERT ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.notify_match_created();

CREATE OR REPLACE FUNCTION public.notify_match_joined()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'match:' || NEW.match_id::text,
    'match_joined',
    jsonb_build_object(
      'matchId', NEW.match_id,
      'userId', NEW.user_id,
      'teamId', NEW.team_id
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER match_players_realtime_trigger
AFTER INSERT ON public.match_players
FOR EACH ROW
EXECUTE FUNCTION public.notify_match_joined();

CREATE OR REPLACE FUNCTION public.notify_match_finished()
RETURNS TRIGGER AS $$
DECLARE
  v_payload jsonb;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'finished' THEN
    v_payload := jsonb_build_object(
      'matchId', NEW.id,
      'homeScore', NEW.home_score,
      'awayScore', NEW.away_score,
      'winnerTeamId', NEW.winner_team_id
    );

    PERFORM realtime.publish('match:' || NEW.id::text, 'match_finished', v_payload);
    PERFORM realtime.publish('lobby:main', 'match_finished', v_payload);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER matches_finished_realtime_trigger
AFTER UPDATE ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.notify_match_finished();
