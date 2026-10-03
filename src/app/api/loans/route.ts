import { requireCompanyId } from "@/lib/auth/session";
import { createLoan, listLoans, postAllDue } from "@/lib/accounting/loans";
import { respond } from "@/lib/shifts/http";
import { audit, yen } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listLoans(companyId));
}

// 登録: 借入の内容 / { action: "postDue" } 返済日が来ている回をまとめて記帳
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  if (body.action === "postDue") {
    return respond(async () => {
      const r = await postAllDue(companyId);
      if (r.posted) await audit("借入金の返済をまとめて記帳", `${r.posted}回分`);
      return r;
    });
  }
  return respond(async () => {
    const l = await createLoan(companyId, body);
    await audit("借入金を登録", `${l.name} ${yen(l.principal)} ${l.months}回${l.openingEntryId ? "(借入の仕訳あり)" : ""}`);
    return l;
  }, 201);
}
