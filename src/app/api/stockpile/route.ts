import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listStock, parseStock, saveStock } from "@/lib/stockpile";
import { audit } from "@/lib/audit";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const people = Number(new URL(request.url).searchParams.get("people")) || undefined;
  return respond(() => listStock(companyId, people));
}

// { action: "parse", text } で1行を分ける、それ以外は記録する
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseStock(String(body.text ?? "")) }));
  return respond(async () => {
    const item = await saveStock({ companyId, name: user.name, role: user.role }, body);
    await audit("備蓄品を記録", `${item.name} ${item.quantity}${item.unit ?? ""}${item.expiresOn ? `(${item.expiresOn}まで)` : ""}`);
    return { item };
  }, 201);
}
