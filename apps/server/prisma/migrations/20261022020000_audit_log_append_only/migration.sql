-- The audit log is append-only: rows can be added, never changed or removed, whatever the application code does.
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog is append-only: % is not allowed.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only_rows"
    BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();

CREATE TRIGGER "AuditLog_append_only_truncate"
    BEFORE TRUNCATE ON "AuditLog"
    FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_append_only"();
