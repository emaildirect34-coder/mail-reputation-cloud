BEGIN;
CREATE TABLE public.operational_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL CHECK (job IN ('daily-report','incident-notifications')),
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status='running' AND finished_at IS NULL) OR (status<>'running' AND finished_at IS NOT NULL))
);
CREATE INDEX operational_job_runs_recent ON public.operational_job_runs(job,started_at DESC);
ALTER TABLE public.operational_job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operational_job_runs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.operational_job_runs TO service_role;
CREATE FUNCTION public.start_operational_job(_job text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE run_id uuid;
BEGIN
 IF _job NOT IN ('daily-report','incident-notifications') THEN RAISE EXCEPTION 'unknown operational job'; END IF;
 INSERT INTO public.operational_job_runs(job,status) VALUES(_job,'running') RETURNING id INTO run_id;
 RETURN run_id;
END;
$$;
CREATE FUNCTION public.finish_operational_job(_id uuid,_success boolean,_duration_ms integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.operational_job_runs SET status=CASE WHEN _success THEN 'succeeded' ELSE 'failed' END,
   finished_at=clock_timestamp(),duration_ms=greatest(0,least(coalesce(_duration_ms,0),2147483647))
 WHERE id=_id AND status='running';
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.start_operational_job(text),public.finish_operational_job(uuid,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_operational_job(text),public.finish_operational_job(uuid,boolean,integer) TO service_role;
COMMIT;
