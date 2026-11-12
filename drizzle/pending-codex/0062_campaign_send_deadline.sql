BEGIN;

ALTER TABLE public.campaigns ADD COLUMN send_expires_at timestamptz,
 ADD CONSTRAINT campaign_deadline_after_start CHECK (send_expires_at IS NULL OR scheduled_at IS NULL OR send_expires_at>scheduled_at);
ALTER TABLE public.campaign_messages ADD COLUMN expired_at timestamptz;
ALTER TABLE public.campaign_messages DROP CONSTRAINT campaign_messages_status_check;
ALTER TABLE public.campaign_messages ADD CONSTRAINT campaign_messages_status_check
 CHECK (status IN ('queued','claimed','sent','failed','skipped','expired'));
CREATE INDEX campaign_deadlines_due ON public.campaigns(send_expires_at,id)
 WHERE send_expires_at IS NOT NULL AND status IN ('queued','paused');

CREATE FUNCTION public.close_expired_campaign(_campaign uuid)
RETURNS void LANGUAGE sql SET search_path=public AS $$
 UPDATE public.campaigns c SET status='done',auto_pause_reason=NULL
 WHERE c.id=_campaign AND c.status IN ('queued','paused') AND NOT EXISTS (
  SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
   AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
 )
$$;

CREATE FUNCTION public.expire_campaign_messages(_server uuid DEFAULT NULL,_campaign uuid DEFAULT NULL,_limit integer DEFAULT 5000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 target record;
 changed integer;
 total integer := 0;
 batch_size integer := greatest(1,least(coalesce(_limit,5000),5000));
 cutoff timestamptz := clock_timestamp();
BEGIN
 FOR target IN
  SELECT c.id,c.send_expires_at FROM public.campaigns c
  WHERE c.send_expires_at<=cutoff AND c.status IN ('queued','paused')
   AND c.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'
   AND (_campaign IS NULL OR c.id=_campaign)
   AND (_server IS NULL OR _server=ANY(c.server_ids))
   AND (EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id AND m.status IN ('queued','claimed')
     AND (_server IS NULL OR m.server_id=_server) AND m.permit_granted_at IS NULL
     AND m.sent_at IS NULL AND m.injection_uncertain_at IS NULL AND m.delivery_state='pending'
   ) OR NOT EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
     AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
   ))
  ORDER BY c.send_expires_at,c.id LIMIT batch_size FOR NO KEY UPDATE OF c SKIP LOCKED
 LOOP
  UPDATE public.campaign_messages m SET status='expired',expired_at=target.send_expires_at,
   error='Date limite de campagne atteinte'
  WHERE m.id IN (
   SELECT cm.id FROM public.campaign_messages cm
   WHERE cm.campaign_id=target.id AND cm.status IN ('queued','claimed')
    AND (_server IS NULL OR cm.server_id=_server) AND cm.permit_granted_at IS NULL
    AND cm.sent_at IS NULL AND cm.injection_uncertain_at IS NULL AND cm.delivery_state='pending'
   ORDER BY cm.id LIMIT batch_size-total FOR UPDATE OF cm SKIP LOCKED
  );
  GET DIAGNOSTICS changed=ROW_COUNT;
  total := total+changed;
  PERFORM public.close_expired_campaign(target.id);
  EXIT WHEN total>=batch_size;
 END LOOP;
 RETURN total;
END;
$$;

ALTER FUNCTION public.campaign_job_ready(public.campaigns,public.campaign_messages) RENAME TO campaign_job_ready_before_deadline;
CREATE FUNCTION public.campaign_job_ready(_campaign public.campaigns,_message public.campaign_messages)
RETURNS boolean LANGUAGE sql SET search_path=public AS $$
 SELECT (_campaign.send_expires_at IS NULL OR (_campaign.send_expires_at>clock_timestamp() AND EXISTS (
  SELECT 1 FROM public.server_agents a WHERE a.server_id=_message.server_id AND a.metrics->>'preferencePermit'='true'
 )))
  AND public.campaign_job_ready_before_deadline(_campaign,_message)
$$;

-- Expired, unpermitted claims are handled by the deadline sweep instead of the receipt timeout.
CREATE OR REPLACE FUNCTION public.claim_campaign_messages_before_probe_cleanup(_server uuid,_limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 budget integer;
 claimed integer;
 remaining integer := greatest(0,least(_limit,500));
 reserved timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_server::text,56056));
 PERFORM public.advance_campaign_waves(_server);
 UPDATE public.campaign_messages m SET
   status=CASE WHEN m.delivery_state='pending' THEN 'failed' ELSE 'sent' END,
   sent_at=CASE WHEN m.delivery_state='pending' THEN m.sent_at ELSE coalesce(m.sent_at,m.permit_granted_at,m.claimed_at) END,
   injection_uncertain_at=CASE WHEN m.delivery_state='pending' THEN now() END,
   error=CASE WHEN m.delivery_state='pending' THEN 'Injection KumoMTA à vérifier' END
 WHERE m.id IN (
   SELECT cm.id FROM public.campaign_messages cm
   WHERE cm.server_id=_server AND cm.status='claimed' AND cm.claimed_at<now()-interval '15 minutes'
   AND NOT (cm.permit_granted_at IS NULL AND cm.sent_at IS NULL AND cm.injection_uncertain_at IS NULL
    AND cm.delivery_state='pending' AND EXISTS (SELECT 1 FROM public.campaigns c
     WHERE c.id=cm.campaign_id AND c.send_expires_at<=clock_timestamp()
      AND c.status IN ('queued','paused') AND c.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'))
   ORDER BY cm.claimed_at,cm.id LIMIT 500 FOR UPDATE OF cm SKIP LOCKED
 );
 PERFORM public.discard_suppressed_campaign_messages(_server,NULL);
 reserved := clock_timestamp();
 SELECT per_minute INTO budget FROM public.server_campaign_capacity WHERE server_id=_server;
 IF budget IS NOT NULL THEN
   SELECT greatest(0,least(remaining,budget-coalesce(sum(r.messages),0)))::integer INTO remaining
    FROM public.campaign_claim_reservations r WHERE r.server_id=_server AND r.reserved_at>reserved-interval '1 minute';
 END IF;
 DELETE FROM public.campaign_claim_reservations r WHERE r.server_id=_server AND r.reserved_at<=reserved-interval '2 minutes';

 RETURN QUERY UPDATE public.campaign_messages SET status='claimed',claimed_at=reserved
 WHERE id IN (
   SELECT cm.id FROM public.campaign_messages cm JOIN public.campaigns c ON c.id=cm.campaign_id
   WHERE cm.server_id=_server AND cm.status='queued' AND public.campaign_job_ready(c,cm)
   ORDER BY c.send_priority DESC,cm.created_at,cm.id LIMIT remaining FOR UPDATE OF c,cm SKIP LOCKED
 ) RETURNING *;
 GET DIAGNOSTICS claimed=ROW_COUNT;
 IF claimed>0 THEN
   INSERT INTO public.campaign_claim_reservations(server_id,reserved_at,messages) VALUES (_server,reserved,claimed);
 END IF;
END;
$$;

ALTER FUNCTION public.claim_campaign_messages(uuid,integer) RENAME TO claim_campaign_messages_before_deadline;
REVOKE ALL ON FUNCTION public.claim_campaign_messages_before_deadline(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_campaign_messages(_server uuid,_limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_server::text,56056));
 PERFORM public.expire_campaign_messages(_server,NULL,1000);
 RETURN QUERY SELECT * FROM public.claim_campaign_messages_before_deadline(_server,_limit);
END;
$$;

-- Serialize with approval, receipt reconciliation and other permits, then check the actual grant time.
CREATE OR REPLACE FUNCTION public.agent_may_inject_approved(_server uuid,_id uuid,_revision uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 job public.campaign_messages;
 campaign public.campaigns;
 allowed boolean;
BEGIN
 SELECT * INTO job FROM public.campaign_messages WHERE id=_id AND server_id=_server AND status='claimed';
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(md5(lower(btrim(job.email))),29029));
 SELECT * INTO campaign FROM public.campaigns WHERE id=job.campaign_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO job FROM public.campaign_messages WHERE id=_id AND server_id=_server AND status='claimed' AND campaign_id=campaign.id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;

 IF campaign.send_expires_at IS NOT NULL AND campaign.send_expires_at<=clock_timestamp() THEN
  allowed := false;
 ELSE
  IF campaign.approval_required THEN
   IF job.permit_granted_at IS NOT NULL OR _revision IS DISTINCT FROM job.claimed_revision THEN RETURN false; END IF;
   IF _revision IS NULL OR _revision IS DISTINCT FROM campaign.review_revision OR _revision IS DISTINCT FROM campaign.approved_revision
    OR NOT coalesce(_server=ANY(campaign.server_ids),false) THEN
    UPDATE public.campaign_messages SET status='queued',claimed_at=NULL,claimed_revision=NULL WHERE id=_id;
    RETURN false;
   END IF;
  END IF;
  allowed := public.agent_may_inject_before_approval(_server,_id);
  IF NOT allowed OR campaign.send_expires_at IS NULL OR campaign.send_expires_at>clock_timestamp() THEN RETURN allowed; END IF;
 END IF;

 IF campaign.status IN ('queued','paused') AND job.permit_granted_at IS NULL
  AND job.sent_at IS NULL AND job.injection_uncertain_at IS NULL AND job.delivery_state='pending' THEN
  UPDATE public.campaign_messages SET status='expired',expired_at=campaign.send_expires_at,
   error='Date limite de campagne atteinte',permit_granted_at=NULL
  WHERE id=_id AND status='claimed';
  IF FOUND THEN PERFORM public.close_expired_campaign(campaign.id); END IF;
 END IF;
 RETURN false;
END;
$$;

ALTER FUNCTION public.campaign_retry_recipient_ok(public.campaigns,public.campaign_messages) RENAME TO campaign_retry_recipient_ok_before_deadline;
CREATE FUNCTION public.campaign_retry_recipient_ok(_campaign public.campaigns,_message public.campaign_messages)
RETURNS boolean LANGUAGE sql SET search_path=public AS $$
 SELECT (_campaign.send_expires_at IS NULL OR _campaign.send_expires_at>clock_timestamp())
  AND public.campaign_retry_recipient_ok_before_deadline(_campaign,_message)
$$;

CREATE FUNCTION public.read_campaign_deadline(_campaign uuid)
RETURNS TABLE(send_expires_at timestamptz,deadline_reached boolean,expired bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 target public.campaigns;
 reached boolean;
BEGIN
 SELECT * INTO target FROM public.campaigns c WHERE c.id=_campaign AND c.send_expires_at IS NOT NULL;
 IF NOT FOUND THEN RETURN; END IF;
 reached := target.send_expires_at<=clock_timestamp();
 IF reached THEN PERFORM public.expire_campaign_messages(NULL,_campaign,1000); END IF;
 RETURN QUERY SELECT target.send_expires_at,reached,count(*)
  FROM public.campaign_messages m WHERE m.campaign_id=_campaign AND (
   m.status='expired' OR (reached AND target.status IN ('queued','paused')
    AND target.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'
    AND m.status IN ('queued','claimed') AND m.permit_granted_at IS NULL AND m.sent_at IS NULL
    AND m.injection_uncertain_at IS NULL AND m.delivery_state='pending')
  );
END;
$$;

CREATE FUNCTION public.track_scheduled_deadline()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.review_revision := gen_random_uuid();
 IF NOT ('deadline'=ANY(NEW.approval_changes)) THEN NEW.approval_changes := array_append(NEW.approval_changes,'deadline'); END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER scheduled_deadline_change BEFORE UPDATE OF send_expires_at ON public.campaigns
 FOR EACH ROW WHEN (OLD.approval_required AND OLD.send_expires_at IS DISTINCT FROM NEW.send_expires_at)
 EXECUTE FUNCTION public.track_scheduled_deadline();

ALTER FUNCTION public.campaign_version_snapshot(public.campaigns) RENAME TO campaign_version_snapshot_before_deadline;
CREATE FUNCTION public.campaign_version_snapshot(_campaign public.campaigns)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT public.campaign_version_snapshot_before_deadline(_campaign)
  || CASE WHEN _campaign.send_expires_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sendExpiresAt',_campaign.send_expires_at) END
$$;
CREATE TRIGGER archive_campaign_deadline AFTER UPDATE OF send_expires_at ON public.campaigns
 FOR EACH ROW WHEN (OLD.send_expires_at IS DISTINCT FROM NEW.send_expires_at) EXECUTE FUNCTION public.archive_campaign_row();

REVOKE ALL ON FUNCTION public.close_expired_campaign(uuid),public.campaign_job_ready(public.campaigns,public.campaign_messages),
 public.campaign_retry_recipient_ok(public.campaigns,public.campaign_messages),public.track_scheduled_deadline(),
 public.campaign_version_snapshot(public.campaigns) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.expire_campaign_messages(uuid,uuid,integer),public.claim_campaign_messages(uuid,integer),
 public.read_campaign_deadline(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_campaign_messages(uuid,uuid,integer),public.claim_campaign_messages(uuid,integer),
 public.read_campaign_deadline(uuid) TO service_role;

DROP FUNCTION public.forecast_campaign_conflicts(jsonb,uuid,smallint,timestamptz,integer,integer,integer);
CREATE FUNCTION public.forecast_campaign_conflicts(
 _recipients jsonb, _server uuid, _priority smallint, _as_of timestamptz, _cap_hours integer,
 _window_start integer, _window_end integer, _draft_deadline timestamptz DEFAULT NULL
)
RETURNS TABLE(overlap bigint, draft_at_risk bigint, campaigns jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH settings AS (
  SELECT make_interval(hours=>greatest(_cap_hours,24)) AS horizon,
         make_interval(hours=>_cap_hours) AS cap,
         jsonb_populate_record(NULL::public.campaigns,
          jsonb_build_object('send_window_start',_window_start,'send_window_end',_window_end)) AS draft
 ), audience AS MATERIALIZED (
  SELECT r.email_md5,
    min(coalesce(public.campaign_quiet_next(s.draft,r.zone,r.planned_at),r.planned_at)) AS planned_at
  FROM jsonb_to_recordset(_recipients) AS r(email_md5 text,planned_at timestamptz,zone text)
  CROSS JOIN settings s
  WHERE r.email_md5 ~ '^[a-f0-9]{32}$' AND r.planned_at >= _as_of
  GROUP BY r.email_md5
 ), pairs AS (
  SELECT DISTINCT ON (a.email_md5,c.id)
    a.email_md5,c.id,c.name,c.scheduled_at,c.send_priority,c.status,
    a.planned_at AS draft_at, timing.planned_at AS other_at,
    m.server_id,m.status='claimed' AS claimed,m.permit_granted_at IS NOT NULL AS permitted
  FROM audience a
  JOIN public.campaign_messages m ON md5(lower(btrim(m.email)))=a.email_md5 AND m.status IN ('queued','claimed')
  JOIN public.campaigns c ON c.id=m.campaign_id
  JOIN public.contact_lists l ON l.id=c.list_id AND l.quarantined_at IS NULL
  CROSS JOIN settings s
  CROSS JOIN LATERAL (SELECT greatest(_as_of,c.scheduled_at,m.available_at) AS earliest) base
  CROSS JOIN LATERAL (
   SELECT coalesce(m.permit_granted_at,public.campaign_quiet_next(c,m.send_time_zone,base.earliest),base.earliest) AS planned_at
  ) timing
  WHERE (c.status='queued' OR (c.status='paused' AND c.scheduled_at IS NOT NULL
   AND c.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'))
    AND (_draft_deadline IS NULL OR a.planned_at<_draft_deadline)
    AND (c.send_expires_at IS NULL OR m.permit_granted_at IS NOT NULL OR timing.planned_at<c.send_expires_at)
    AND timing.planned_at BETWEEN a.planned_at-s.horizon AND a.planned_at+s.horizon
  ORDER BY a.email_md5,c.id,timing.planned_at,(m.permit_granted_at IS NOT NULL) DESC,(m.status='claimed') DESC,m.id
 ), projected AS MATERIALIZED (
  SELECT p.*,
   CASE
    WHEN _cap_hours=0 OR other_at<=draft_at-s.cap OR other_at>=draft_at+s.cap THEN NULL
    WHEN other_at<draft_at OR (other_at=draft_at AND (permitted OR claimed)) THEN 'draft'
    WHEN other_at>draft_at THEN 'other'
    WHEN server_id=_server THEN CASE WHEN _priority>send_priority THEN 'other' ELSE 'draft' END
    ELSE 'uncertain'
   END AS delayed
  FROM pairs p CROSS JOIN settings s
 ), per_campaign AS (
  SELECT id,name,scheduled_at,send_priority,status,
   count(*) AS overlap,
   count(*) FILTER (WHERE delayed='draft') AS draft_delayed,
   count(*) FILTER (WHERE delayed='other') AS other_delayed,
   count(*) FILTER (WHERE delayed='uncertain') AS uncertain
  FROM projected GROUP BY id,name,scheduled_at,send_priority,status
 )
 SELECT (SELECT count(DISTINCT email_md5) FROM projected),
        (SELECT count(DISTINCT email_md5) FROM projected WHERE delayed IN ('draft','uncertain')),
        coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.scheduled_at NULLS FIRST,p.id) FROM per_campaign p),'[]'::jsonb)
$$;

REVOKE ALL ON FUNCTION public.forecast_campaign_conflicts(jsonb,uuid,smallint,timestamptz,integer,integer,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.forecast_campaign_conflicts(jsonb,uuid,smallint,timestamptz,integer,integer,integer,timestamptz) TO service_role;
COMMIT;
