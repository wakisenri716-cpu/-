import { requireCompanyId } from "@/lib/auth/session";
import { createAllocation, listAllocations, postAllDue } from "@/lib/accounting/allocations";
import { respond } from "@/lib/shifts/http";
import { audit, yen } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listAllocations(companyId));
}

// 登録: 按分の内容 / { action: "postDue" } 今月までの未計上分をまとめて計上
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  if (body.action === "postDue") {
    return respond(async () => {
      const r = await postAllDue(companyId);
      if (r.posted) await audit("期間按分をまとめて計上", `${r.posted}か月分`);
      return r;
    });
  }
  return respond(async () => {
    const a = await createAllocation(companyId, body);
    await audit("期間按分を登録", `${a.name} ${yen(a.totalAmount)} ${a.startMonth}から${a.months}か月${a.openingEntryId ? "(支払・入金の仕訳あり)" : ""}`);
    return a;
  }, 201);
}
