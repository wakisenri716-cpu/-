import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { createAnnouncement, listAnnouncements, unreadAnnouncements } from "@/lib/announcements";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";
import { notifyAnnouncement } from "@/lib/push/events";

// お知らせの一覧(従業員も見られる)
export async function GET(request: Request) {
  const user = await requireMember();
  // ?unread=1 なら、まだ読んでいないお知らせの件数と新しいものだけ
  if (new URL(request.url).searchParams.get("unread")) return NextResponse.json(await unreadAnnouncements(user));
  return NextResponse.json(await listAnnouncements(user));
}

export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  try {
    const { announcement, mailed } = await createAnnouncement(user, body, request);
    await audit("お知らせを書いた", `${announcement.title}${mailed ? `(メール ${mailed}通)` : ""}`);
    notifyAnnouncement(user.companyId, user.id, announcement);
    return NextResponse.json({ id: announcement.id, mailed }, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
