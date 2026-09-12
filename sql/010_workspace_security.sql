CREATE TABLE plans (
 code text PRIMARY KEY, storage_quota_bytes bigint NOT NULL CHECK(storage_quota_bytes>=0),
 document_quota_bytes bigint NOT NULL CHECK(document_quota_bytes>=0), upload_max_bytes bigint NOT NULL CHECK(upload_max_bytes>=0)
);
INSERT INTO plans VALUES('FREE_BETA',524288000,52428800,26214400);
CREATE TABLE user_plan_assignments (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 plan_code text NOT NULL REFERENCES plans(code) DEFAULT 'FREE_BETA'
);
CREATE TABLE user_usage (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 storage_used_bytes bigint NOT NULL DEFAULT 0 CHECK(storage_used_bytes>=0),
 storage_reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(storage_reserved_bytes>=0),
 document_used_bytes bigint NOT NULL DEFAULT 0 CHECK(document_used_bytes>=0)
);
INSERT INTO user_usage(user_id,storage_used_bytes,document_used_bytes)
 SELECT u.id,coalesce((SELECT sum(size_bytes) FROM resources WHERE user_id=u.id),0),
 coalesce((SELECT sum(octet_length(title)+octet_length(content::text)) FROM documents WHERE user_id=u.id),0) FROM users u;
ALTER TABLE documents ADD COLUMN trashed_at timestamptz,
 ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',title || ' ' || content::text)) STORED;
CREATE INDEX documents_search ON documents USING gin(search_vector);
CREATE INDEX documents_active_owner ON documents(user_id,updated_at DESC,id) WHERE trashed_at IS NULL;
ALTER TABLE resources DROP CONSTRAINT resources_status_check;
ALTER TABLE resources ADD CONSTRAINT resources_status_check CHECK(status IN ('uploading','pending_validation','pending_scan','scanning','ready','quarantined','scan_failed','trashed','deleting','deleted'));
ALTER TABLE resources ADD COLUMN trashed_at timestamptz,
 ADD COLUMN previous_status text,
 ADD COLUMN content_sha256 text,
 ADD COLUMN scan_engine text,
 ADD COLUMN scanned_at timestamptz,
 ADD COLUMN detection text,
 ADD COLUMN reader_content jsonb;
-- Existing unscanned files must be scanned before further access.
UPDATE resources SET status='pending_scan' WHERE status='ready';
CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('scan')),
 resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 dedupe_key text NOT NULL UNIQUE, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','dead')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pending ON jobs(available_at) WHERE state='pending';
INSERT INTO jobs(kind,resource_id,dedupe_key) SELECT 'scan',id,'scan:'||id FROM resources WHERE status='pending_scan';
ALTER TABLE object_deletions ADD COLUMN lease_token uuid, ADD COLUMN lease_until timestamptz,
 ADD COLUMN state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dead'));
