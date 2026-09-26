-- AlterTable
ALTER TABLE "ExpenseItem" ADD COLUMN     "receiptSha256" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sourceSha256" TEXT;

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "sha256" TEXT;

-- CreateTable
CREATE TABLE "RecordHistory" (
    "id" BIGSERIAL NOT NULL,
    "companyId" TEXT,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordHistory_companyId_changedAt_idx" ON "RecordHistory"("companyId", "changedAt");

-- CreateIndex
CREATE INDEX "RecordHistory_tableName_recordId_idx" ON "RecordHistory"("tableName", "recordId");


-- ============================================================
-- 証憑ファイルの SHA-256(登録したときに固定する。あとで中身が変わると改ざんチェックで分かる)
-- ============================================================
UPDATE "ExpenseItem" SET "receiptSha256" = encode(sha256(decode(split_part("receiptImageUrl", ',', 2), 'base64')), 'hex')
  WHERE "receiptImageUrl" LIKE 'data:%;base64,%' AND "receiptSha256" IS NULL;
UPDATE "Invoice" SET "sourceSha256" = encode(sha256(decode(split_part("sourceFileUrl", ',', 2), 'base64')), 'hex')
  WHERE "sourceFileUrl" LIKE 'data:%;base64,%' AND "sourceSha256" IS NULL;
UPDATE "StoredFile" SET "sha256" = encode(sha256("data"), 'hex') WHERE "sha256" IS NULL;

CREATE OR REPLACE FUNCTION keiri_expense_item_hash() RETURNS trigger AS $$
BEGIN
  IF NEW."receiptSha256" IS NULL AND NEW."receiptImageUrl" LIKE 'data:%;base64,%' THEN
    BEGIN
      NEW."receiptSha256" := encode(sha256(decode(split_part(NEW."receiptImageUrl", ',', 2), 'base64')), 'hex');
    EXCEPTION WHEN others THEN
      NEW."receiptSha256" := NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION keiri_invoice_hash() RETURNS trigger AS $$
BEGIN
  IF NEW."sourceSha256" IS NULL AND NEW."sourceFileUrl" LIKE 'data:%;base64,%' THEN
    BEGIN
      NEW."sourceSha256" := encode(sha256(decode(split_part(NEW."sourceFileUrl", ',', 2), 'base64')), 'hex');
    EXCEPTION WHEN others THEN
      NEW."sourceSha256" := NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION keiri_stored_file_hash() RETURNS trigger AS $$
BEGIN
  IF NEW."sha256" IS NULL THEN
    NEW."sha256" := encode(sha256(NEW."data"), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_item_hash BEFORE INSERT ON "ExpenseItem" FOR EACH ROW EXECUTE FUNCTION keiri_expense_item_hash();
CREATE TRIGGER invoice_hash BEFORE INSERT ON "Invoice" FOR EACH ROW EXECUTE FUNCTION keiri_invoice_hash();
CREATE TRIGGER stored_file_hash BEFORE INSERT ON "StoredFile" FOR EACH ROW EXECUTE FUNCTION keiri_stored_file_hash();

-- ============================================================
-- 訂正・削除の履歴。登録・変更・削除のたびに変更前後を RecordHistory に書く。
-- 大きなファイルの中身は入れず、代わりにその指紋(SHA-256)を入れる。共有リンクの鍵は入れない。
-- ============================================================
CREATE OR REPLACE FUNCTION keiri_history_row(r jsonb, tbl text) RETURNS jsonb AS $$
DECLARE
  j jsonb := r - 'receiptImageUrl' - 'sourceFileUrl' - 'data' - 'shareToken';
BEGIN
  IF tbl = 'ExpenseItem' THEN
    j := j || jsonb_build_object('receiptFileDigest', CASE WHEN r->>'receiptImageUrl' IS NULL THEN NULL ELSE encode(sha256(convert_to(r->>'receiptImageUrl', 'UTF8')), 'hex') END);
  ELSIF tbl = 'Invoice' THEN
    j := j || jsonb_build_object('sourceFileDigest', CASE WHEN r->>'sourceFileUrl' IS NULL THEN NULL ELSE encode(sha256(convert_to(r->>'sourceFileUrl', 'UTF8')), 'hex') END);
  END IF;
  RETURN j;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION keiri_record_history() RETURNS trigger AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
  row_j jsonb;
  company text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_j := keiri_history_row(to_jsonb(OLD), TG_TABLE_NAME); END IF;
  IF TG_OP <> 'DELETE' THEN new_j := keiri_history_row(to_jsonb(NEW), TG_TABLE_NAME); END IF;
  IF TG_OP = 'UPDATE' AND old_j = new_j THEN RETURN NULL; END IF;
  row_j := COALESCE(new_j, old_j);
  company := row_j->>'companyId';
  IF company IS NULL THEN
    IF TG_TABLE_NAME = 'JournalLine' THEN
      SELECT "companyId" INTO company FROM "JournalEntry" WHERE id = row_j->>'journalEntryId';
    ELSIF TG_TABLE_NAME = 'ExpenseItem' THEN
      SELECT "companyId" INTO company FROM "ExpenseReport" WHERE id = row_j->>'expenseReportId';
    ELSIF TG_TABLE_NAME = 'InvoiceLine' THEN
      SELECT "companyId" INTO company FROM "Invoice" WHERE id = row_j->>'invoiceId';
    END IF;
  END IF;
  INSERT INTO "RecordHistory" ("companyId", "tableName", "recordId", "action", "oldData", "newData", "changedAt")
  VALUES (company, TG_TABLE_NAME, row_j->>'id', TG_OP, old_j, new_j, (now() AT TIME ZONE 'UTC'));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_history AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION keiri_record_history();
CREATE TRIGGER journal_line_history AFTER INSERT OR UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION keiri_record_history();
CREATE TRIGGER expense_item_history AFTER INSERT OR UPDATE OR DELETE ON "ExpenseItem" FOR EACH ROW EXECUTE FUNCTION keiri_record_history();
CREATE TRIGGER invoice_history AFTER INSERT OR UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION keiri_record_history();
CREATE TRIGGER invoice_line_history AFTER INSERT OR UPDATE OR DELETE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION keiri_record_history();
CREATE TRIGGER payment_history AFTER INSERT OR UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION keiri_record_history();
CREATE TRIGGER stored_file_history AFTER INSERT OR UPDATE OR DELETE ON "StoredFile" FOR EACH ROW EXECUTE FUNCTION keiri_record_history();

-- 履歴そのものは書き換え・削除できない(追記だけ)
CREATE OR REPLACE FUNCTION keiri_history_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RECORD_HISTORY_READONLY: 訂正・削除の履歴は変更できません';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER record_history_readonly BEFORE UPDATE OR DELETE ON "RecordHistory" FOR EACH ROW EXECUTE FUNCTION keiri_history_readonly();
CREATE TRIGGER record_history_no_truncate BEFORE TRUNCATE ON "RecordHistory" FOR EACH STATEMENT EXECUTE FUNCTION keiri_history_readonly();
