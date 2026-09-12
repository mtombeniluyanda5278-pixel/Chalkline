-- Native documents share revision semantics; uploaded resources remain separate.
CREATE TABLE documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('note','lesson','template')),
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 content jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(content) = 'object'),
 planned_date date,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,user_id)
);
CREATE INDEX documents_owner_recent ON documents(user_id,kind,updated_at DESC);
CREATE INDEX documents_schedule ON documents(user_id,planned_date) WHERE kind='lesson';
CREATE TABLE document_revisions (
 document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 revision integer NOT NULL, title text NOT NULL, content jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(document_id,revision)
);
CREATE TABLE resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 object_key text NOT NULL UNIQUE, original_name text NOT NULL, title text NOT NULL,
 mime text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes > 0),
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','ready','deleting')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,user_id)
);
CREATE INDEX resources_owner_recent ON resources(user_id,created_at DESC);
CREATE TABLE lesson_resources (
 document_id uuid NOT NULL, resource_id uuid NOT NULL, user_id uuid NOT NULL,
 PRIMARY KEY(document_id,resource_id),
 FOREIGN KEY(document_id,user_id) REFERENCES documents(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE
);
CREATE INDEX lesson_resources_resource ON lesson_resources(resource_id);
CREATE TABLE resume_state (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 document_id uuid, resource_id uuid,
 item_id uuid GENERATED ALWAYS AS (coalesce(document_id,resource_id)) STORED,
 state jsonb NOT NULL DEFAULT '{}', opened_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,item_id), CHECK(num_nonnulls(document_id,resource_id)=1),
 FOREIGN KEY(document_id,user_id) REFERENCES documents(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE
);
CREATE INDEX resume_recent ON resume_state(user_id,opened_at DESC);
-- Durable deletion outbox deliberately outlives account/metadata removal.
CREATE TABLE object_deletions (
 object_key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION queue_resource_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO object_deletions(object_key) VALUES(OLD.object_key) ON CONFLICT DO NOTHING;
 RETURN OLD;
END $$;
CREATE TRIGGER resource_deletion AFTER DELETE ON resources FOR EACH ROW EXECUTE FUNCTION queue_resource_deletion();
