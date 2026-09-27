import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createRequest, KIND_LABELS, listRequests, type RequestKind } from "@/lib/approvals/service";
import { appUrl } from "@/lib/mail";
import { audit } from "@/lib/audit";

// 従業員も使う(自分の申請と、自分が承認する申請だけが見える)
export async function GET(request: Request) {
  const user = await requireMember();
  const view = new URL(request.url).searchParams.get("view") ?? "mine";
  return respond(() => listRequests(user, view));
}

export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const created = await createRequest(user, body, appUrl(request));
    await audit("稟議を申請", `${created.number} ${KIND_LABELS[created.kind as RequestKind]} ${created.title}`, user);
    return created;
  }, 201);
}
