import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { findCardMatches, parseCardText, readCardImage, type ReadResult } from "@/lib/businessCards";
import { UserError } from "@/lib/errors";

// 名刺の写真(AIで読み取る)か、名刺の文字(貼り付け)から項目を取り出し、もう登録されている相手を探す
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const isForm = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
  const form = isForm ? await request.formData().catch(() => null) : null;
  const json = isForm ? null : await request.json().catch(() => null);
  return respond(async () => {
    let result: ReadResult;
    if (isForm) {
      const file = form?.get("file");
      if (!(file instanceof File)) throw new UserError("名刺の写真を選んでください");
      result = await readCardImage(companyId, user.id, file);
    } else {
      const text = typeof json?.text === "string" ? json.text.slice(0, 2000) : "";
      if (!text.trim()) throw new UserError("名刺の文字を入れてください");
      const card = parseCardText(text);
      if (!card.company && !card.name) throw new UserError("会社名や氏名が見つかりませんでした。1行に1項目ずつ入れてください");
      result = { cards: [card], mode: "template", note: null };
    }
    const cards = await Promise.all(result.cards.map(async (card) => ({ card, matches: await findCardMatches(companyId, card) })));
    return { cards, mode: result.mode, note: result.note };
  });
}
