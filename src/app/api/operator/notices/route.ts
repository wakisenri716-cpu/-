import { NextResponse } from "next/server";
import { respond } from "@/lib/shifts/http";
import { operatorAudit, operatorOr404 } from "@/lib/operatorApi";
import { createNotice } from "@/lib/support";

// 運営からのお知らせを出す { title, body, level, endsAt }
export async function POST(request: Request) {
  const user = await operatorOr404();
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const n = await createNotice(body);
    await operatorAudit(user, `お知らせを出した: ${n.title}`);
    return n;
  }, 201);
}
