import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { myNotices, parseNotice, submitNotice } from "@/lib/changeNotices";

// 自分の届け出
export async function GET() {
  const user = await requireMember();
  return respond(async () => ({ notices: await myNotices(user) }));
}

// { action: "parse", text } で1行を分ける、それ以外は届け出る
export async function POST(request: Request) {
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseNotice(String(body.text ?? "")) }));
  return respond(async () => ({ notice: await submitNotice(user, body) }), 201);
}
