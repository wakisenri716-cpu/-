-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "booksClosedThrough" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "reorderPoint" INTEGER;


-- 締め処理: 会社の booksClosedThrough 以前の日付の仕訳(と明細)は、追加・変更・削除をデータベースで拒否する。
-- どの画面・処理から書き込んでも必ず止まるよう、アプリではなくトリガーで守る。
CREATE OR REPLACE FUNCTION journal_books_closed_check() RETURNS trigger AS $$
DECLARE
  closed TIMESTAMP(3);
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "booksClosedThrough" INTO closed FROM "Company" WHERE id = OLD."companyId";
    IF closed IS NOT NULL AND OLD."date" < closed + INTERVAL '1 day' THEN
      RAISE EXCEPTION 'BOOKS_CLOSED:%', to_char(closed, 'YYYY-MM-DD');
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "booksClosedThrough" INTO closed FROM "Company" WHERE id = NEW."companyId";
    IF closed IS NOT NULL AND NEW."date" < closed + INTERVAL '1 day' THEN
      RAISE EXCEPTION 'BOOKS_CLOSED:%', to_char(closed, 'YYYY-MM-DD');
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_books_closed
  BEFORE INSERT OR UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION journal_books_closed_check();

CREATE OR REPLACE FUNCTION journal_line_books_closed_check() RETURNS trigger AS $$
DECLARE
  closed TIMESTAMP(3);
  entry_date TIMESTAMP(3);
BEGIN
  SELECT c."booksClosedThrough", e."date" INTO closed, entry_date
    FROM "JournalEntry" e JOIN "Company" c ON c.id = e."companyId"
    WHERE e.id = (CASE WHEN TG_OP = 'DELETE' THEN OLD."journalEntryId" ELSE NEW."journalEntryId" END);
  IF closed IS NOT NULL AND entry_date < closed + INTERVAL '1 day' THEN
    RAISE EXCEPTION 'BOOKS_CLOSED:%', to_char(closed, 'YYYY-MM-DD');
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_books_closed
  BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION journal_line_books_closed_check();
