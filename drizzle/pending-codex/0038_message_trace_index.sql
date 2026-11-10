CREATE INDEX IF NOT EXISTS delivery_events_message_trace
  ON public.delivery_events(message_id, occurred_at DESC, id DESC);
