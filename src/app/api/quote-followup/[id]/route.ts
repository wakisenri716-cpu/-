import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftFollowMail, extendQuote } from "@/lib/quoteFollowup";
import { appUrl } from "@/lib/mail";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

// 追いかけのメールの下書き(送るのは見積書のメール送信 /api/mail/send で)
export async function POST(request: Request, { params }: Params) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => draftFollowMail({ id: user.id, companyId, name: user.name }, id, body ?? {}, appUrl(request)));
}

// 有効期限を延ばす
export async function PATCH(request: Request, { params }: Params) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const quote = await extendQuote(companyId, id, body?.days);
    await audit("見積書の有効期限を延長", `${quote.quoteNumber} → ${quote.validUntil.toISOString().slice(0, 10)}`);
    return { validUntil: quote.validUntil.toISOString().slice(0, 10) };
  });
}
