import { requireCompanyId } from "@/lib/auth/session";
import { getPriceReview } from "@/lib/priceReview";
import { aiEnabled } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import PriceReviewView from "./PriceReviewView";

export const dynamic = "force-dynamic";

export default async function PriceReviewPage() {
  const companyId = await requireCompanyId();
  const [review, ai] = await Promise.all([getPriceReview(companyId), aiEnabled(companyId)]);
  // 改定の時期の初期値: 来月の次の月の1日(お知らせから1か月以上あける)
  const [y, m] = jstDateKey(new Date()).split("-").map(Number);
  const effective = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  return <PriceReviewView review={review} ai={ai} defaultEffective={effective} />;
}
