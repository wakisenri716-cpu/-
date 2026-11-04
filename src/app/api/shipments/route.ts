import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listShipments, parseShipment, postShipments, saveShipment } from "@/lib/shipments";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";

// ?month=YYYY-MM か ?q=(相手・中身・追跡番号で探す)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const sp = new URL(request.url).searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") ?? "") ? sp.get("month")! : jstDateKey(new Date()).slice(0, 7);
  return respond(() => listShipments(companyId, month, (sp.get("q") ?? "").trim().slice(0, 40) || undefined));
}

// { action: "parse", text } / { action: "post", month } 送料を仕訳 / それ以外は記録
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const me = { companyId, name: user.name, role: user.role };
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseShipment(String(body.text ?? "")) }));
  if (body.action === "post")
    return respond(async () => {
      const r = await postShipments(me, body);
      await audit("送料を仕訳", `${body.month} ${r.count}件 ${r.total.toLocaleString()}円(通信費)`);
      return r;
    });
  return respond(async () => ({ shipment: await saveShipment(me, body) }), 201);
}
