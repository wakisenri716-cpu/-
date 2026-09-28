import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { deleteAnnouncement, markRead, updateAnnouncement } from "@/lib/announcements";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

function fail(error: unknown) {
  if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}

// 読んだ印を付ける(全員)
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  try {
    await markRead(user, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  try {
    const a = await updateAnnouncement(user, id, body);
    await audit("お知らせを直した", a.title);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireMember();
  try {
    const a = await deleteAnnouncement(user, id);
    await audit("お知らせを消した", a.title);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
