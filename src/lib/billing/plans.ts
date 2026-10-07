// 料金プラン(表示用の金額は税込)。実際に請求する金額は Stripe の「価格」で決まるので、変えるときは両方そろえる。
// それぞれのプランに「AI込み」(このサービスのAIを使う・割高)と「AI持ち込み」(会社が自分で契約したAIを使う・割安)がある。
// 金額は環境変数 PRICE_LIGHT_YEN / PRICE_STANDARD_YEN(AI込み)・PRICE_LIGHT_BYO_YEN / PRICE_STANDARD_BYO_YEN(AI持ち込み)で変えられる。

export const TRIAL_DAYS = 30;

export type PlanKey = "LIGHT" | "STANDARD";
export type AiMode = "INCLUDED" | "BYO";
export const AI_MODES: AiMode[] = ["INCLUDED", "BYO"];
export const AI_MODE_INFO: Record<AiMode, { name: string; summary: string }> = {
  INCLUDED: { name: "AI込み", summary: "このサービスのAIをそのまま使えます。AIの利用料は月額に含まれます" },
  BYO: { name: "AI持ち込み", summary: "自社で契約したAI(AnthropicのAPIキー)を使います。AIの利用料は自社持ちの分、お安くなります" },
};

const yen = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function plans() {
  return {
    LIGHT: {
      key: "LIGHT" as const,
      name: "ライト",
      price: yen(process.env.PRICE_LIGHT_YEN, 2980),
      byoPrice: yen(process.env.PRICE_LIGHT_BYO_YEN, 1980),
      // 管理者・経理担当の人数の上限(従業員=Clerkly従業員用・経費精算・タイムカードを使う人は数えない)
      seats: 2,
      summary: "ひとりで経理をする小さな会社・お店に",
      features: ["会計・請求書・経費精算・給与など全機能", "管理者・経理担当 2人まで", "従業員(Clerkly従業員用)は人数無制限", "メールサポート"],
    },
    STANDARD: {
      key: "STANDARD" as const,
      name: "スタンダード",
      price: yen(process.env.PRICE_STANDARD_YEN, 6980),
      byoPrice: yen(process.env.PRICE_STANDARD_BYO_YEN, 4980),
      seats: null as number | null,
      summary: "複数人で経理をする会社・複数店舗に",
      features: ["会計・請求書・経費精算・給与など全機能", "管理者・経理担当 人数無制限", "従業員(Clerkly従業員用)は人数無制限", "メールサポート(優先)"],
    },
  } satisfies Record<PlanKey, { key: PlanKey; name: string; price: number; byoPrice: number; seats: number | null; summary: string; features: string[] }>;
}

export function planPrice(plan: PlanKey, aiMode: AiMode) {
  const p = plans()[plan];
  return aiMode === "BYO" ? p.byoPrice : p.price;
}

// Stripe の価格: STRIPE_PRICE_LIGHT / STRIPE_PRICE_STANDARD(AI込み)・STRIPE_PRICE_LIGHT_BYO / STRIPE_PRICE_STANDARD_BYO(AI持ち込み)
export function priceEnvName(plan: PlanKey, aiMode: AiMode) {
  return `STRIPE_PRICE_${plan}${aiMode === "BYO" ? "_BYO" : ""}`;
}

export function priceIdOf(plan: PlanKey, aiMode: AiMode = "INCLUDED") {
  return process.env[priceEnvName(plan, aiMode)] || null;
}

export function planOfPrice(priceId: string | null | undefined): { plan: PlanKey; aiMode: AiMode } | null {
  if (!priceId) return null;
  for (const plan of ["LIGHT", "STANDARD"] as const) for (const aiMode of AI_MODES) if (priceIdOf(plan, aiMode) === priceId) return { plan, aiMode };
  return null;
}
