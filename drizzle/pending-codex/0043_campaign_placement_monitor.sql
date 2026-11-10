BEGIN;

CREATE TABLE public.campaign_placement_monitors (
  campaign_id uuid PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  test_campaign_id uuid NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
  server_id uuid NOT NULL,
  placement_id text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  seeds jsonb NOT NULL,
  observed_at timestamptz,
  completed_at timestamptz
);
ALTER TABLE public.campaign_placement_monitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_placement_monitors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.campaign_placement_monitors TO service_role;

CREATE FUNCTION public.start_campaign_placement_monitor(
  _campaign uuid, _server uuid, _placement text, _token text, _expires timestamptz, _seeds jsonb
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  source public.campaigns%ROWTYPE;
  test_id uuid;
  addresses text[];
BEGIN
  SELECT * INTO STRICT source FROM public.campaigns WHERE id = _campaign FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.campaign_placement_monitors WHERE campaign_id = _campaign) THEN RETURN; END IF;
  IF source.status = 'cancelled' OR NOT (_server = ANY(source.server_ids))
    OR NOT EXISTS (SELECT 1 FROM public.server_agents WHERE server_id = _server)
    OR _expires <= now() OR _token !~ '^ED-[A-Z0-9]{5,32}$' THEN
    RAISE EXCEPTION 'Campaign or placement test unavailable';
  END IF;
  SELECT array_agg(DISTINCT lower(seed->>'address')) INTO addresses
  FROM jsonb_array_elements(_seeds) AS seeds(seed);
  IF coalesce(cardinality(addresses), 0) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Invalid placement seed count';
  END IF;

  INSERT INTO public.campaigns (
    name, from_name, from_email, reply_to, subject, html, amp_html,
    server_ids, vmta_pool_id, status, total, created_by
  ) VALUES (
    'Test Inbox ' || _token, source.from_name, source.from_email, source.reply_to,
    source.subject || ' [' || _token || ']', source.html, source.amp_html,
    ARRAY[_server], source.vmta_pool_id, 'queued', cardinality(addresses), source.created_by
  ) RETURNING id INTO test_id;
  INSERT INTO public.campaign_messages (campaign_id, server_id, email)
  SELECT test_id, _server, address FROM unnest(addresses) AS address;
  INSERT INTO public.campaign_placement_monitors (campaign_id, test_campaign_id, server_id, placement_id, expires_at, seeds)
  VALUES (_campaign, test_id, _server, _placement, _expires, _seeds);
END;
$$;

CREATE FUNCTION public.read_campaign_delivery_by_domain(_campaign uuid)
RETURNS TABLE (
  domain text, queued bigint, claimed bigint, injected bigint, injection_failed bigint,
  accepted bigint, deferred bigint, bounced bigint, complained bigint, oldest_due_at timestamptz
) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT lower(split_part(m.email, '@', 2)),
    count(*) FILTER (WHERE m.status = 'queued'),
    count(*) FILTER (WHERE m.status = 'claimed'),
    count(*) FILTER (WHERE m.status = 'sent'),
    count(*) FILTER (WHERE m.status = 'failed'),
    count(*) FILTER (WHERE m.delivery_state = 'delivered'),
    count(*) FILTER (WHERE m.delivery_state = 'deferred'),
    count(*) FILTER (WHERE m.delivery_state = 'bounced'),
    count(*) FILTER (WHERE m.delivery_state = 'complained'),
    min(greatest(m.created_at, m.available_at, c.scheduled_at))
      FILTER (WHERE m.status = 'queued' AND greatest(m.created_at, m.available_at, c.scheduled_at) <= now())
  FROM public.campaign_messages m JOIN public.campaigns c ON c.id = m.campaign_id
  WHERE m.campaign_id = _campaign GROUP BY 1;
$$;

REVOKE ALL ON FUNCTION public.start_campaign_placement_monitor(uuid,uuid,text,text,timestamptz,jsonb),
  public.read_campaign_delivery_by_domain(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_campaign_placement_monitor(uuid,uuid,text,text,timestamptz,jsonb),
  public.read_campaign_delivery_by_domain(uuid) TO service_role;
COMMIT;
