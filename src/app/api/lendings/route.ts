import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listLendings, parseLending, saveLending } from "@/lib/lendings";
import { audit } from "@/lib/audit";

// ?q=(貸したもの・相手で探す)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  return respond(() => listLendings(companyId, q || undefined));
}

// { action: "parse", text } / それ以外は記録
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseLending(companyId, String(body.text ?? "")) }));
  return respond(async () => {
    const lending = await saveLending({ companyId, name: user.name, role: user.role }, body);
    await audit("貸し出しを記録", `${lending.item} → ${lending.borrowerName}`);
    return { lending };
  }, 201);
}
