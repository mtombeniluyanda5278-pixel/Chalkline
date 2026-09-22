CREATE TABLE admin_email_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 admin_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('service','announcement')),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
 encrypted_body text NOT NULL,
 filters jsonb NOT NULL,
 recipient_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 queued_at timestamptz,
 queued_count integer
);
