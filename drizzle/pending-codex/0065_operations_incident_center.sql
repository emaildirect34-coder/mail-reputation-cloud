BEGIN;

CREATE TABLE public.operations_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 signal_key text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('campaign_blocked','injection_uncertain','agent_offline')),
 title text NOT NULL,
 detail text NOT NULL,
 server_id uuid,
 affected_campaigns jsonb NOT NULL DEFAULT '[]',
 affected_messages bigint CHECK (affected_messages>=0),
 started_at timestamptz NOT NULL,
 last_observed_at timestamptz NOT NULL,
 signal_cleared_at timestamptz,
 assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 resolved_at timestamptz,
 resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 resolution_note text CHECK (char_length(resolution_note)<=500)
);
CREATE UNIQUE INDEX operations_incident_active_signal ON public.operations_incidents(signal_key) WHERE signal_cleared_at IS NULL;
CREATE INDEX operations_incident_by_status ON public.operations_incidents(resolved_at,started_at DESC,id);
CREATE INDEX operations_incident_by_assignee ON public.operations_incidents(assigned_to,resolved_at,started_at DESC,id);
ALTER TABLE public.operations_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operations_incidents FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operations_incidents TO service_role;

CREATE FUNCTION public.sync_operations_incidents()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 checked_at timestamptz;
BEGIN
 IF NOT pg_try_advisory_xact_lock(65065) THEN RETURN false; END IF;
 checked_at := clock_timestamp();
 WITH due_campaigns AS MATERIALIZED (
  SELECT c.id,c.name,c.server_ids,c.status,c.auto_pause_reason,c.approval_required,c.approved_revision,c.review_revision,c.created_at
  FROM public.campaigns c
  WHERE c.status IN ('queued','paused') AND (c.scheduled_at IS NULL OR c.scheduled_at<=checked_at)
   AND (c.send_expires_at IS NULL OR c.send_expires_at>checked_at)
   AND c.placement_probe_of IS NULL AND NOT c.purchase_thank_you
 ), blocked AS (
  SELECT 'campaign:'||c.id::text AS signal_key,'campaign_blocked' AS kind,c.name AS title,
   CASE WHEN c.auto_pause_reason IS NOT NULL THEN left(c.auto_pause_reason,300)
        ELSE 'La version programmée attend une validation.' END AS detail,
   NULL::uuid AS server_id,jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name)) AS affected_campaigns,
   NULL::bigint AS affected_messages,checked_at AS started_at
  FROM due_campaigns c
  WHERE (
   (c.auto_pause_reason IS NOT NULL AND CASE c.auto_pause_reason
    WHEN 'Préparation des destinataires en cours' THEN c.created_at<=checked_at-interval '15 minutes'
    WHEN 'Contrôle des boîtes témoins en attente' THEN c.created_at<=checked_at-interval '10 minutes'
    ELSE true END)
   OR (c.status='queued' AND c.approval_required AND c.approved_revision IS DISTINCT FROM c.review_revision)
  ) AND (c.auto_pause_reason='Préparation des destinataires en cours'
   OR EXISTS (SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id AND m.status IN ('queued','claimed')))
 ), uncertain AS (
  SELECT 'injection:'||c.id::text,'injection_uncertain',c.name,'Des messages attendent une vérification de leur injection.',
   NULL::uuid,jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name)),count(*),min(m.injection_uncertain_at)
  FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
  WHERE m.injection_uncertain_at IS NOT NULL AND c.placement_probe_of IS NULL
  GROUP BY c.id,c.name
 ), offline AS (
  SELECT 'agent:'||s.id::text,'agent_offline',s.label,
   CASE WHEN a.last_seen<=checked_at-interval '5 minutes' THEN 'Aucun signal de l’agent depuis au moins cinq minutes.'
        ELSE 'L’agent KumoMTA signale une erreur.' END,
   s.id,coalesce(affected.items,'[]'::jsonb),NULL::bigint,
   CASE WHEN a.last_seen<=checked_at-interval '5 minutes' THEN a.last_seen+interval '5 minutes' ELSE a.last_seen END
  FROM public.server_agents a JOIN public.managed_servers s ON s.id=a.server_id
  CROSS JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name,c.id) AS items
   FROM due_campaigns c WHERE s.id=ANY(c.server_ids) AND (c.status='queued' OR c.auto_pause_reason IS NOT NULL) AND EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id AND m.server_id=s.id AND m.status IN ('queued','claimed')
   )
  ) affected
  WHERE s.status<>'absent' AND s.maintenance_since IS NULL AND a.last_seen IS NOT NULL
   AND (a.status='error' OR a.last_seen<=checked_at-interval '5 minutes')
 ), incoming AS MATERIALIZED (
  SELECT * FROM blocked UNION ALL SELECT * FROM uncertain UNION ALL SELECT * FROM offline
 ), observed AS (
  INSERT INTO public.operations_incidents AS i(signal_key,kind,title,detail,server_id,affected_campaigns,affected_messages,started_at,last_observed_at)
  SELECT n.signal_key,n.kind,n.title,n.detail,n.server_id,n.affected_campaigns,n.affected_messages,n.started_at,checked_at FROM incoming n
  ON CONFLICT (signal_key) WHERE signal_cleared_at IS NULL DO UPDATE SET
   title=excluded.title,detail=excluded.detail,affected_campaigns=excluded.affected_campaigns,
   affected_messages=excluded.affected_messages,started_at=least(i.started_at,excluded.started_at),
   last_observed_at=excluded.last_observed_at
  RETURNING i.id
 )
 UPDATE public.operations_incidents i SET signal_cleared_at=checked_at
 WHERE i.signal_cleared_at IS NULL AND NOT EXISTS (SELECT 1 FROM incoming n WHERE n.signal_key=i.signal_key);
 RETURN true;
END;
$$;

CREATE FUNCTION public.can_work_operations_incidents(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT public.has_role(_user,'superadmin') OR (public.has_role(_user,'worker') AND EXISTS (
  SELECT 1 FROM public.worker_tasks t WHERE t.user_id=_user AND t.status='active' AND '/dashboard/incidents'=ANY(t.allowed_paths)
 ))
$$;

CREATE FUNCTION public.operations_incident_assignees()
RETURNS TABLE(id uuid,label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT u.id,coalesce(nullif(btrim(p.full_name),''),u.email,'Compte '||left(u.id::text,8))
 FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id
 WHERE public.can_work_operations_incidents(u.id) ORDER BY 2,1
$$;

CREATE FUNCTION public.manage_operations_incident(_id uuid,_actor uuid,_action text,_assignee uuid DEFAULT NULL,_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE is_admin boolean := public.has_role(_actor,'superadmin');
BEGIN
 IF _action='assign' THEN
  IF NOT is_admin OR (_assignee IS NOT NULL AND NOT public.can_work_operations_incidents(_assignee)) THEN RETURN false; END IF;
  UPDATE public.operations_incidents SET assigned_to=_assignee WHERE id=_id AND resolved_at IS NULL;
 ELSIF _action='resolve' THEN
  IF NOT public.can_work_operations_incidents(_actor) OR char_length(_note)>500 THEN RETURN false; END IF;
  UPDATE public.operations_incidents SET resolved_at=clock_timestamp(),resolved_by=_actor,resolution_note=nullif(btrim(_note),'')
  WHERE id=_id AND resolved_at IS NULL AND (is_admin OR assigned_to=_actor);
 ELSIF _action='reopen' THEN
  IF NOT is_admin THEN RETURN false; END IF;
  UPDATE public.operations_incidents SET resolved_at=NULL,resolved_by=NULL,resolution_note=NULL WHERE id=_id AND resolved_at IS NOT NULL;
 ELSE
  RETURN false;
 END IF;
 RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.can_work_operations_incidents(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.sync_operations_incidents(),public.operations_incident_assignees(),
 public.manage_operations_incident(uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_operations_incidents(),public.operations_incident_assignees(),
 public.manage_operations_incident(uuid,uuid,text,uuid,text) TO service_role;
COMMIT;
