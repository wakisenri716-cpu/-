import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createCheckout } from "@/lib/billing";
import { appUrl } from "@/lib/mail";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// { plan } で Stripe の支払い画面を作って URL を返す
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  try {
    return await respond(async () => {
      const url = await createCheckout(user, body.plan, appUrl(request));
      await audit("有料プランの申し込みを開始", String(body.plan));
      return { url };
    });
  } catch (error) {
    // Stripe の設定まちがい(キー・価格ID)などは、画面に原因を出す
    if (error instanceof Error && !(error instanceof UserError) && "type" in error) {
      console.error("stripe checkout failed", error);
      return NextResponse.json({ error: `お支払い画面を開けませんでした(${error.message})` }, { status: 502 });
    }
    throw error;
  }
}
