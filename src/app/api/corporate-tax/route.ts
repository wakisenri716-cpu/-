import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { cancelCorporateTax, getCorporateTax, saveCorporateTax } from "@/lib/accounting/corporateTax";
import { audit } from "@/lib/audit";

const yearOf = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));

// ?fy=年度 の計算(入力を保存していればその入力で)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const fy = yearOf(new URL(request.url).searchParams.get("fy"));
  return respond(() => getCorporateTax(companyId, fy));
}

// { fy, input, post } 入力を保存する。post: true なら期末の日付で仕訳も作る(前の仕訳は作り直す)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await saveCorporateTax(companyId, user, yearOf(body.fy), body.input, body.post === true);
    if (r.posted) await audit("法人税等の計上", `${r.fiscalYear}年度 ${r.total.toLocaleString()}円(中間納付 ${r.interim.toLocaleString()}円)`);
    return r;
  });
}

// ?fy=年度 の計上を取り消す
export async function DELETE(request: Request) {
  const companyId = await requireCompanyId();
  const fy = Number(new URL(request.url).searchParams.get("fy"));
  return respond(async () => {
    await cancelCorporateTax(companyId, fy);
    await audit("法人税等の計上の取消", `${fy}年度`);
    return { ok: true };
  });
}
