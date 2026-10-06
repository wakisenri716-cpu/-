import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { listInbox, processInboxFile } from "@/lib/inbox";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { aiEnabled } from "@/lib/ai/access";

const MAX_FILES = 10;

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json({ items: await listInbox(companyId), aiEnabled: await aiEnabled(companyId) });
}

// files: 書類(画像・PDF)を何枚でも(1回10枚まで)
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const files = (await request.formData()).getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "書類のファイルを選んでください" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `一度に入れられるのは${MAX_FILES}枚までです` }, { status: 400 });
  const results = [];
  for (const file of files) {
    try {
      const item = await processInboxFile(user, file);
      results.push({ ok: true, item });
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      results.push({ ok: false, fileName: file.name, error: error.message });
    }
  }
  await audit("AI受付箱に書類を入れた", `${files.length}件(${results.filter((r) => r.ok).length}件を振り分け)`);
  return NextResponse.json({ results }, { status: 201 });
}
