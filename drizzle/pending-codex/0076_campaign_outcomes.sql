BEGIN;

CREATE TABLE public.campaign_followup_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (campaign_id,task_key)
);
CREATE INDEX campaign_followup_queue ON public.campaign_followup_tasks(status,created_at DESC);
ALTER TABLE public.campaign_followup_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_followup_tasks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.campaign_followup_tasks TO service_role;

CREATE FUNCTION public.seed_campaign_followup_tasks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='done' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.campaign_followup_tasks(campaign_id,task_key,title) VALUES
      (NEW.id,'delivery-review','Examiner les résultats SMTP et les boîtes témoins'),
      (NEW.id,'audience-review','Examiner les plaintes, rebonds et désinscriptions');
    IF NEW.sponsor_offer_id IS NOT NULL THEN
      INSERT INTO public.campaign_followup_tasks(campaign_id,task_key,title)
      VALUES (NEW.id,'conversion-reconciliation','Rapprocher les conversions avec le réseau sponsor');
    END IF;
    INSERT INTO public.campaign_followup_tasks(campaign_id,task_key,title)
    VALUES (NEW.id,'reply-review','Consulter les réponses remontées par le connecteur');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_campaign_followup_tasks() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER campaign_followup_on_completion AFTER UPDATE OF status ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public.seed_campaign_followup_tasks();
INSERT INTO public.campaign_followup_tasks(campaign_id,task_key,title)
SELECT c.id,t.task_key,t.title FROM public.campaigns c CROSS JOIN (VALUES
 ('delivery-review','Examiner les résultats SMTP et les boîtes témoins'),
 ('audience-review','Examiner les plaintes, rebonds et désinscriptions'),
 ('reply-review','Consulter les réponses remontées par le connecteur')
) t(task_key,title) WHERE c.status='done'
ON CONFLICT (campaign_id,task_key) DO NOTHING;
INSERT INTO public.campaign_followup_tasks(campaign_id,task_key,title)
SELECT id,'conversion-reconciliation','Rapprocher les conversions avec le réseau sponsor'
FROM public.campaigns WHERE status='done' AND sponsor_offer_id IS NOT NULL
ON CONFLICT (campaign_id,task_key) DO NOTHING;

CREATE FUNCTION public.read_campaign_outcome_comparison(_left uuid,_right uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH chosen AS (
   SELECT c.id,c.name,c.status,c.created_at,c.total,c.suppressed,c.sponsor_offer_id
   FROM public.campaigns c WHERE c.id IN (_left,_right) AND _left IS DISTINCT FROM _right
 ), stats AS (
   SELECT c.id,
     count(m.id)::bigint AS queued_total,
     count(m.id) FILTER (WHERE m.sent_at IS NOT NULL OR m.status='sent')::bigint AS attempted,
     count(m.id) FILTER (WHERE m.delivery_state='delivered' OR EXISTS (
       SELECT 1 FROM public.delivery_events e WHERE e.message_id=m.id AND e.campaign_id=c.id AND e.event_type='delivered'))::bigint AS accepted,
     count(m.id) FILTER (WHERE m.status='failed' OR m.delivery_state='bounced' OR EXISTS (
       SELECT 1 FROM public.delivery_events e WHERE e.message_id=m.id AND e.campaign_id=c.id AND e.event_type='bounced'))::bigint AS bounced,
     count(m.id) FILTER (WHERE m.opened_at IS NOT NULL)::bigint AS opens,
     count(m.id) FILTER (WHERE m.clicked_at IS NOT NULL)::bigint AS clicks,
     count(DISTINCT m.id) FILTER (WHERE EXISTS (
       SELECT 1 FROM public.delivery_events e WHERE e.message_id=m.id AND e.campaign_id=c.id AND e.event_type='complained'))::bigint AS complaints,
     count(DISTINCT md5(lower(btrim(m.email)))) FILTER (WHERE EXISTS (
       SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(m.email)))
         AND s.reason='unsubscribe' AND s.source='campagne '||c.id::text))::bigint AS unsubscribes
   FROM chosen c LEFT JOIN public.campaign_messages m ON m.campaign_id=c.id
   GROUP BY c.id
 ), purchases AS (
   SELECT c.id,count(*) FILTER (WHERE p.status='approved')::bigint AS count,
     coalesce(sum(f.amount_cents) FILTER (WHERE p.status='approved'),0)::bigint AS amount_cents
   FROM chosen c LEFT JOIN public.campaign_messages m ON m.campaign_id=c.id
   LEFT JOIN public.sponsor_purchases p ON p.source_message_id=m.id AND p.offer_id=c.sponsor_offer_id
   LEFT JOIN public.finance_entries f ON f.id=p.finance_id
   GROUP BY c.id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',c.id,'name',c.name,'status',c.status,'created_at',c.created_at,
   'audience',c.total,'suppressed',c.suppressed,'attempted',s.attempted,
   'smtp_accepted',s.accepted,'bounced',s.bounced,'opens',s.opens,'clicks',s.clicks,
   'complaints',s.complaints,'unsubscribes',s.unsubscribes,
   'approved_purchases',p.count,'purchase_amount_cents',p.amount_cents,
   'acceptance_rate',CASE WHEN s.attempted=0 THEN NULL ELSE round(100.0*s.accepted/s.attempted,2) END,
   'open_rate_observed',CASE WHEN s.attempted=0 THEN NULL ELSE round(100.0*s.opens/s.attempted,2) END,
   'click_rate_observed',CASE WHEN s.attempted=0 THEN NULL ELSE round(100.0*s.clicks/s.attempted,2) END,
   'complaint_rate',CASE WHEN s.attempted=0 THEN NULL ELSE round(100.0*s.complaints/s.attempted,3) END
 ) ORDER BY c.id), '[]'::jsonb) FROM chosen c JOIN stats s ON s.id=c.id JOIN purchases p ON p.id=c.id
$$;
REVOKE ALL ON FUNCTION public.read_campaign_outcome_comparison(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_campaign_outcome_comparison(uuid,uuid) TO service_role;

COMMIT;
