import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createPortal } from "@/lib/billing";
import { appUrl } from "@/lib/mail";
import { UserError } from "@/lib/errors";

// カードの変更・プランの変更・解約・領収書の画面(Stripe)を開く
export async function POST(request: Request) {
  const user = await requireMember();
  try {
    return await respond(async () => ({ url: await createPortal(user, appUrl(request)) }));
  } catch (error) {
    if (error instanceof Error && !(error instanceof UserError) && "type" in error) {
      console.error("stripe portal failed", error);
      return NextResponse.json({ error: `お支払い情報の画面を開けませんでした(${error.message})` }, { status: 502 });
    }
    throw error;
  }
}
