-- Additive directory; existing documents remain unassigned and untouched.
CREATE TABLE teaching_subjects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100), grades integer[] NOT NULL CHECK(grades <@ ARRAY[8,9,10,11,12]),
 archived_at timestamptz, UNIQUE(id,user_id)
);
CREATE TABLE teaching_classes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100), grade integer NOT NULL CHECK(grade BETWEEN 8 AND 12),
 archived_at timestamptz, UNIQUE(id,user_id)
);
CREATE TABLE teaching_workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subject_id uuid NOT NULL, class_id uuid NOT NULL, UNIQUE(subject_id,class_id), UNIQUE(id,user_id),
 FOREIGN KEY(subject_id,user_id) REFERENCES teaching_subjects(id,user_id),
 FOREIGN KEY(class_id,user_id) REFERENCES teaching_classes(id,user_id)
);
ALTER TABLE documents ADD COLUMN workspace_id uuid, ADD COLUMN term integer CHECK(term BETWEEN 1 AND 4),
 ADD COLUMN week integer CHECK(week BETWEEN 1 AND 53), ADD COLUMN lesson_status text NOT NULL DEFAULT 'Draft' CHECK(lesson_status IN ('Draft','Planned','Taught','Needs review')),
 ADD COLUMN taught_at timestamptz,
 ADD CONSTRAINT document_workspace_owner FOREIGN KEY(workspace_id,user_id) REFERENCES teaching_workspaces(id,user_id),
 ADD CONSTRAINT lesson_workspace_only CHECK(workspace_id IS NULL OR kind='lesson');
CREATE INDEX lessons_by_workspace ON documents(user_id,workspace_id,updated_at DESC) WHERE kind='lesson' AND trashed_at IS NULL;
CREATE TABLE teaching_learners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 class_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), identifier text NOT NULL DEFAULT '' CHECK(length(identifier)<=100),
 FOREIGN KEY(class_id,user_id) REFERENCES teaching_classes(id,user_id) ON DELETE CASCADE
);
CREATE TABLE class_resources (
 workspace_id uuid NOT NULL, resource_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY(workspace_id,resource_id),
 FOREIGN KEY(workspace_id,user_id) REFERENCES teaching_workspaces(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE
);
ALTER TABLE resources ADD COLUMN category text NOT NULL DEFAULT 'Documents' CHECK(category IN ('Videos','Pictures','Documents','Activities','Assignments','Presentations','Worksheets')),
 ADD COLUMN external_url text;
ALTER TABLE resources ALTER COLUMN object_key DROP NOT NULL;
ALTER TABLE resources DROP CONSTRAINT resources_size_bytes_check;
ALTER TABLE resources ADD CONSTRAINT resource_storage_kind CHECK(
 (external_url IS NULL AND object_key IS NOT NULL AND size_bytes>0) OR
 (external_url IS NOT NULL AND external_url LIKE 'https://%' AND object_key IS NULL AND size_bytes=0 AND mime='video/link' AND category='Videos')
);
UPDATE resources SET category=CASE WHEN mime LIKE 'image/%' THEN 'Pictures' WHEN mime LIKE '%presentation%' THEN 'Presentations' ELSE 'Documents' END;
CREATE OR REPLACE FUNCTION queue_resource_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.object_key IS NOT NULL THEN INSERT INTO object_deletions(object_key) VALUES(OLD.object_key) ON CONFLICT DO NOTHING; END IF;
 RETURN OLD;
END $$;
