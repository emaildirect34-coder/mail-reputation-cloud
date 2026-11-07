CREATE TYPE public.app_role AS ENUM ('superadmin', 'worker');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "own or superadmin read roles" ON public.user_roles FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'superadmin'));

CREATE TABLE public.worker_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  allowed_paths text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_tasks TO authenticated;
GRANT ALL ON public.worker_tasks TO service_role;
ALTER TABLE public.worker_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "worker reads own tasks" ON public.worker_tasks FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "superadmin inserts tasks" ON public.worker_tasks FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "superadmin updates tasks" ON public.worker_tasks FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "superadmin deletes tasks" ON public.worker_tasks FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "superadmin reads profiles" ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'));