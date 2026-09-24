import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { generateSecret, otpauthUrl } from "@/lib/auth/totp";

// 設定を始める: 新しい鍵を「設定途中」として保存し、認証アプリで読み取るQRコードを返す(まだ有効にはしない)
export async function POST() {
  const user = await requireUser();
  if (user.totpEnabled) return NextResponse.json({ error: "2段階認証はすでに有効です" }, { status: 400 });
  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecret: secret } });
  const url = otpauthUrl(secret, user.email);
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return NextResponse.json({ secret, qrSvg });
}
