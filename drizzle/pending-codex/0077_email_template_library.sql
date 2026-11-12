BEGIN;
CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  subject text NOT NULL DEFAULT '' CHECK (length(subject)<=300), html text NOT NULL DEFAULT '' CHECK (length(html)<=500000),
  version integer NOT NULL DEFAULT 1 CHECK (version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.email_template_versions (
  template_id uuid NOT NULL REFERENCES public.email_templates(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  snapshot jsonb NOT NULL, PRIMARY KEY(template_id,version)
);
CREATE TABLE public.email_content_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  html text NOT NULL CHECK (length(html) BETWEEN 1 AND 100000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_content_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_templates,public.email_template_versions,public.email_content_blocks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.email_templates,public.email_template_versions,public.email_content_blocks TO service_role;

CREATE FUNCTION public.save_email_template(_id uuid,_name text,_subject text,_html text)
RETURNS TABLE(id uuid,version integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.email_templates;
BEGIN
 IF length(btrim(_name)) NOT BETWEEN 1 AND 120 OR length(_subject)>300 OR length(_html)>500000 THEN RAISE EXCEPTION 'template_invalid'; END IF;
 IF _id IS NULL THEN
   INSERT INTO public.email_templates(name,subject,html) VALUES(btrim(_name),_subject,_html) RETURNING * INTO saved;
 ELSE
   SELECT * INTO saved FROM public.email_templates WHERE email_templates.id=_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'template_missing'; END IF;
   UPDATE public.email_templates AS t SET name=btrim(_name),subject=_subject,html=_html,version=t.version+1,updated_at=clock_timestamp()
    WHERE email_templates.id=_id RETURNING * INTO saved;
 END IF;
 INSERT INTO public.email_template_versions(template_id,version,snapshot)
 VALUES(saved.id,saved.version,jsonb_build_object('name',saved.name,'subject',saved.subject,'html',saved.html));
 RETURN QUERY SELECT saved.id,saved.version;
END;
$$;
CREATE FUNCTION public.restore_email_template_version(_id uuid,_version integer)
RETURNS TABLE(id uuid,version integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE previous jsonb; saved public.email_templates;
BEGIN
 SELECT snapshot INTO previous FROM public.email_template_versions WHERE template_id=_id AND email_template_versions.version=_version;
 IF previous IS NULL THEN RAISE EXCEPTION 'template_version_missing'; END IF;
 UPDATE public.email_templates AS t SET name=previous->>'name',subject=previous->>'subject',html=previous->>'html',version=t.version+1,updated_at=clock_timestamp()
 WHERE email_templates.id=_id RETURNING * INTO saved;
 IF NOT FOUND THEN RAISE EXCEPTION 'template_missing'; END IF;
 INSERT INTO public.email_template_versions(template_id,version,snapshot)
 VALUES(saved.id,saved.version,jsonb_build_object('name',saved.name,'subject',saved.subject,'html',saved.html));
 RETURN QUERY SELECT saved.id,saved.version;
END;
$$;
REVOKE ALL ON FUNCTION public.save_email_template(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.restore_email_template_version(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_email_template(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_email_template_version(uuid,integer) TO service_role;
COMMIT;
