import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { jstDateKey } from "@/lib/jst";
import { createGift, DIRECTIONS, listGifts, parseGift, SEASONS, type Direction, type Season } from "@/lib/gifts";
import { audit } from "@/lib/audit";

// ?year=YYYY(既定は今年)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const raw = Number(new URL(request.url).searchParams.get("year"));
  const year = Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : Number(jstDateKey(new Date()).slice(0, 4));
  return respond(() => listGifts(companyId, year));
}

// { action: "parse", text } で1行を分ける、それ以外は記録する
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (body.action === "parse") return respond(async () => ({ draft: await parseGift(companyId, String(body.text ?? "")) }));
  return respond(async () => {
    const gift = await createGift({ companyId, name: user.name }, body);
    await audit("贈答品を記録", `${gift.partyName} ${SEASONS[gift.season as Season]}(${DIRECTIONS[gift.direction as Direction]})${gift.item ? ` ${gift.item}` : ""}`);
    return { gift };
  }, 201);
}
