import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { updateContact, type PartyKind } from "@/lib/addressBook";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 顧客・取引先の住所・宛名を保存する
export async function PUT(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const companyId = await requireCompanyId();
  if (kind !== "customer" && kind !== "vendor") return NextResponse.json({ error: "種類が正しくありません" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  try {
    const contact = await updateContact(companyId, kind as PartyKind, id, body);
    await audit(kind === "customer" ? "顧客の住所を変更" : "取引先の住所を変更", [contact.postalCode, contact.address].filter(Boolean).join(" ") || "(空欄)");
    return NextResponse.json(contact);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
