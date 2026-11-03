import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listHealth, parseHealth, saveHealth, KINDS } from "@/lib/healthChecks";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const y = Number(new URL(request.url).searchParams.get("year"));
  return respond(() => listHealth(companyId, y >= 2000 && y <= 2100 ? y : Number(jstDateKey(new Date()).slice(0, 4))));
}

// { action: "parse", text } で1行を分ける、それ以外は記録する(同じ人・種類・年の予約があればそれを書きかえる)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseHealth(companyId, String(body.text ?? "")) }));
  return respond(async () => {
    const record = await saveHealth({ companyId, name: user.name, role: user.role }, body);
    await audit("健康診断を記録", `${record.staffName} ${KINDS[record.kind as keyof typeof KINDS] ?? record.kind} ${record.doneOn ? `${record.doneOn}に受けた` : `予約 ${record.plannedOn}`}`);
    return { record };
  }, 201);
}
