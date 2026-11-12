ALTER TABLE public.campaigns ADD COLUMN topic text CHECK (topic IN ('news','offers','events','education'));

CREATE TABLE public.recipient_topic_preferences (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$'),
  topics text[] NOT NULL CHECK (
    cardinality(topics) BETWEEN 1 AND 4
    AND array_position(topics, NULL) IS NULL
    AND topics <@ ARRAY['news','offers','events','education']
  )
);
ALTER TABLE public.recipient_topic_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipient_topic_preferences TO service_role;

CREATE FUNCTION public.set_recipient_topics(_token text, _topics text[])
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
BEGIN
  IF _topics IS NOT NULL AND (
    cardinality(_topics) NOT BETWEEN 1 AND 4
    OR array_ndims(_topics) IS DISTINCT FROM 1
    OR NOT (_topics <@ ARRAY['news','offers','events','education'])
    OR cardinality(_topics) <> (SELECT count(DISTINCT topic) FROM unnest(_topics) topic)
  ) THEN RETURN 'invalid'; END IF;

  SELECT md5(lower(btrim(cm.email))) INTO recipient FROM public.campaign_messages cm WHERE cm.unsub_token = _token;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  IF EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient) THEN RETURN 'suppressed'; END IF;

  IF _topics IS NULL THEN
    DELETE FROM public.recipient_topic_preferences p WHERE p.email_md5 = recipient;
  ELSE
    INSERT INTO public.recipient_topic_preferences(email_md5, topics) VALUES (recipient, _topics)
    ON CONFLICT (email_md5) DO UPDATE SET topics = EXCLUDED.topics;
  END IF;
  RETURN 'saved';
END;
$$;

REVOKE ALL ON FUNCTION public.set_recipient_topics(text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_recipient_topics(text,text[]) TO service_role;