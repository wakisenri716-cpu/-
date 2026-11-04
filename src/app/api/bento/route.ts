import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { daySummary, markPaid, monthTotals, parseMenu, saveShop, sendShopOrder } from "@/lib/bento";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";

// その日のまとめと、月の一人ずつの合計(?date=YYYY-MM-DD&month=YYYY-MM)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const sp = new URL(request.url).searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") ?? "") ? sp.get("month")! : jstDateKey(new Date()).slice(0, 7);
  return respond(async () => ({ day: await daySummary(companyId, sp.get("date") ?? undefined), month, totals: await monthTotals(companyId, month) }));
}

// { action: "menu", text, useAi } メニューを読む / "shop" お店を登録 / "send" お店に注文を送る / "paid" 集金した
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const me = { id: user.id, name: user.name, companyId, role: user.role };
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "menu") return respond(() => parseMenu(me, body));
  if (body.action === "send")
    return respond(async () => {
      const r = await sendShopOrder(me, body);
      await audit("お弁当の注文を送った", `${r.count}個`);
      return r;
    });
  if (body.action === "paid") return respond(() => markPaid(me, body));
  return respond(async () => ({ shop: await saveShop(me, body) }), 201);
}
