INSERT INTO plans VALUES('UNVERIFIED',0,2097152,0);
-- Byte accounting uses PostgreSQL's normalized JSONB UTF-8 representation, including retained revisions.
UPDATE user_usage u SET document_used_bytes=document_used_bytes+coalesce((SELECT sum(octet_length(r.title)+octet_length(r.content::text)) FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.user_id=u.user_id),0);
CREATE FUNCTION account_document_bytes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; delta bigint; allowance bigint;
BEGIN
 IF TG_TABLE_NAME='documents' THEN
   owner_id=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 ELSE
   SELECT user_id INTO owner_id FROM documents WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END;
 END IF;
 IF owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=owner_id) THEN RETURN coalesce(NEW,OLD); END IF;
 INSERT INTO user_usage(user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 SELECT p.document_quota_bytes INTO allowance FROM users u LEFT JOIN user_plan_assignments a ON a.user_id=u.id JOIN plans p ON p.code=CASE WHEN u.email_verified_at IS NULL THEN 'UNVERIFIED' ELSE coalesce(a.plan_code,'FREE_BETA') END WHERE u.id=owner_id;
 delta=CASE WHEN TG_OP='DELETE' THEN 0 ELSE octet_length(NEW.title)+octet_length(NEW.content::text) END-CASE WHEN TG_OP='INSERT' THEN 0 ELSE octet_length(OLD.title)+octet_length(OLD.content::text) END;
 UPDATE user_usage SET document_used_bytes=document_used_bytes+delta WHERE user_id=owner_id AND (delta<=0 OR document_used_bytes+delta<=allowance);
 IF NOT FOUND THEN RAISE EXCEPTION 'Document quota reached' USING ERRCODE='P0001'; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER document_usage BEFORE INSERT OR UPDATE OF title,content OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION account_document_bytes();
CREATE TRIGGER revision_usage BEFORE INSERT OR DELETE ON document_revisions FOR EACH ROW EXECUTE FUNCTION account_document_bytes();
-- The parent row is still visible while children are deleted, so their usage can be released.
CREATE FUNCTION remove_document_revisions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN DELETE FROM document_revisions WHERE document_id=OLD.id; RETURN OLD; END $$;
CREATE TRIGGER document_revision_cleanup BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION remove_document_revisions();
