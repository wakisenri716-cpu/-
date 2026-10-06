import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { UserError } from "@/lib/errors";
import { buildPeppolXml } from "@/lib/peppol";

// 発行した請求書をデジタルインボイス(JP PINT の XML)で書き出す
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  try {
    const { xml, fileName } = await buildPeppolXml(companyId, id);
    return new NextResponse(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"` },
    });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
