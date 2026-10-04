import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createManual, listManualsForAdmin } from "@/lib/manuals";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listManualsForAdmin(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const m = await createManual(companyId, body);
    await audit("マニュアルを作成", m.title);
    return m;
  }, 201);
}
