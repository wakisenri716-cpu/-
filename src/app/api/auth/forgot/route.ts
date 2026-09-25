import { NextResponse, after } from "next/server";
import { requestPasswordReset } from "@/lib/auth/passwordReset";
import { appUrl } from "@/lib/mail";

// 登録の有無にかかわらず、いつも同じ応答を同じ速さで返す(メールは応答を返したあとに送る)
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const baseUrl = appUrl(request);
  after(async () => {
    try {
      await requestPasswordReset(body.email, baseUrl);
    } catch (error) {
      console.error("パスワード再設定メールの送信に失敗しました", error);
    }
  });
  return NextResponse.json({ ok: true });
}
