import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { ACTION_LABELS, actOnRequest, getRequest } from "@/lib/approvals/service";
import { appUrl } from "@/lib/mail";
import { audit } from "@/lib/audit";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  const found = await getRequest(user, id);
  if (!found) return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });
  return NextResponse.json(found);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const result = await actOnRequest(user, id, body, appUrl(request));
    const label = ACTION_LABELS[String(body.action ?? "").toUpperCase()];
    if (label && body.action !== "comment") await audit(`稟議を${label}`, result.number, user);
    return result;
  });
}
