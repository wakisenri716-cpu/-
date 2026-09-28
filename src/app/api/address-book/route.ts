import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { listAddressBook } from "@/lib/addressBook";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listAddressBook(companyId));
}
