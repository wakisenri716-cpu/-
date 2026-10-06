import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addComment, listComments, setResolved } from "@/lib/journalComments";
import { audit } from "@/lib/audit";

// 仕訳へのコメント(税理士・閲覧だけの人も書ける)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  return respond(() => listComments(companyId, id));
}

// { body } でコメントを足す / { resolved: true|false } で解決済み・未解決にする
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (typeof body.resolved === "boolean") {
      const r = await setResolved(companyId, user, id, body.resolved);
      await audit(body.resolved ? "仕訳のコメントを解決済みに" : "仕訳のコメントを未解決に戻す", r.entry.description);
      return r.comments;
    }
    const r = await addComment(companyId, user, id, body.body);
    await audit("仕訳にコメント", `${r.entry.description}: ${String(body.body).slice(0, 60)}`);
    return r.comments;
  });
}
