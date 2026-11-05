import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { listPhonebook, parsePhoneLines, savePhoneEntries } from "@/lib/phonebook";
import { audit } from "@/lib/audit";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  return respond(() => listPhonebook(companyId, q || undefined));
}

// { action: "parse", text } 貼り付けた行を読む / { entries: [...] } まとめて入れる
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(() => parsePhoneLines(companyId, String(body.text ?? "")));
  return respond(async () => {
    const r = await savePhoneEntries({ companyId, role: user.role }, body.entries);
    await audit("電話帳を更新", `${r.saved}件`);
    return r;
  });
}
