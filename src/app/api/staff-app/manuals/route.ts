import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listManualsForUser } from "@/lib/manuals";

export async function GET() {
  const user = await requireMember();
  return respond(() => listManualsForUser(user.companyId, user.id));
}
