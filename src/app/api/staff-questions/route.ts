import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listQuestions } from "@/lib/staffQuestions";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ questions: await listQuestions(companyId) }));
}
