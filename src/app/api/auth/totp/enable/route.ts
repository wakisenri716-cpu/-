import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { generateRecoveryCodes, verifyTotp } from "@/lib/auth/totp";
import { audit } from "@/lib/audit";

// 認証アプリに表示された6桁コードで確認できたら有効にし、回復コードを1回だけ返す
export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  if (user.totpEnabled) return NextResponse.json({ error: "2段階認証はすでに有効です" }, { status: 400 });
  if (!user.totpPendingSecret) return NextResponse.json({ error: "先に「設定を始める」を押してください" }, { status: 400 });
  const step = verifyTotp(user.totpPendingSecret, String(body.code ?? ""), null);
  if (step === null) return NextResponse.json({ error: "コードが違います。認証アプリに表示されている最新の6桁を入力してください" }, { status: 400 });
  const recovery = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: true, totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpLastStep: step, recoveryCodes: recovery.stored },
  });
  await audit("2段階認証を有効化", null, user);
  return NextResponse.json({ recoveryCodes: recovery.codes });
}
