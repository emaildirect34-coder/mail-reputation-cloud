BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('agent-suppression-snapshots', 'agent-suppression-snapshots', false, 12000052, ARRAY['application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
