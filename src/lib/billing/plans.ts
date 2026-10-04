// 料金プラン(表示用の金額は税込)。実際に請求する金額は Stripe の「価格」で決まるので、変えるときは両方そろえる。
// 金額は環境変数 PRICE_LIGHT_YEN / PRICE_STANDARD_YEN で変えられる。

export const TRIAL_DAYS = 30;

export type PlanKey = "LIGHT" | "STANDARD";

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
      // 管理者・経理担当の人数の上限(従業員=スタッフアプリ・経費精算・タイムカードを使う人は数えない)
      seats: 2,
      summary: "ひとりで経理をする小さな会社・お店に",
      features: ["会計・請求書・経費精算・給与など全機能", "管理者・経理担当 2人まで", "従業員(スタッフアプリ)は人数無制限", "メールサポート"],
    },
    STANDARD: {
      key: "STANDARD" as const,
      name: "スタンダード",
      price: yen(process.env.PRICE_STANDARD_YEN, 6980),
      seats: null as number | null,
      summary: "複数人で経理をする会社・複数店舗に",
      features: ["会計・請求書・経費精算・給与など全機能", "管理者・経理担当 人数無制限", "従業員(スタッフアプリ)は人数無制限", "メールサポート(優先)"],
    },
  } satisfies Record<PlanKey, { key: PlanKey; name: string; price: number; seats: number | null; summary: string; features: string[] }>;
}

export function priceIdOf(plan: PlanKey) {
  return (plan === "LIGHT" ? process.env.STRIPE_PRICE_LIGHT : process.env.STRIPE_PRICE_STANDARD) || null;
}

export function planOfPrice(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_LIGHT) return "LIGHT";
  if (priceId === process.env.STRIPE_PRICE_STANDARD) return "STANDARD";
  return null;
}
