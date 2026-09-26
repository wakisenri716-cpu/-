import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { verifyEvidence } from "@/lib/compliance";
import { audit } from "@/lib/audit";

// 証憑ファイルの改ざんチェック(登録時の指紋と、いまの中身を比べる)
export async function POST() {
  const companyId = await requireCompanyId();
  const result = await verifyEvidence(companyId);
  await audit("証憑の改ざんチェック", `${result.checked}件中 問題${result.problems.length}件`);
  return NextResponse.json(result);
}
