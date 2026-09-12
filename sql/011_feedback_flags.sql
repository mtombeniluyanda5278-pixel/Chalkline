CREATE TABLE feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category text NOT NULL CHECK(category IN ('bug','feature','usability','content','other')),
 message text NOT NULL CHECK(length(message) BETWEEN 10 AND 4000),
 diagnostics jsonb CHECK(diagnostics IS NULL OR jsonb_typeof(diagnostics)='object'),
 status text NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','REVIEWING','PLANNED','RESOLVED','CLOSED')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_owner ON feedback(user_id,created_at DESC);
CREATE INDEX feedback_status ON feedback(status,created_at DESC);
CREATE TABLE feature_flags (
 name text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 percentage integer NOT NULL DEFAULT 0 CHECK(percentage BETWEEN 0 AND 100)
);
INSERT INTO feature_flags(name,enabled) VALUES ('birthday',true),('experimental_pdf',false),('new_planner',false),('lecturer',false),('future_ai',false);
CREATE TABLE feature_flag_overrides (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 flag text NOT NULL REFERENCES feature_flags(name) ON DELETE CASCADE,
 enabled boolean NOT NULL, PRIMARY KEY(user_id,flag)
);
