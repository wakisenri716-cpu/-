// 年末調整の計算(目安)。データベースには触らないので、画面でも同じ計算を使える。
// 令和7年(2025年)分の改正(給与所得控除の最低額65万円・基礎控除の引上げ)に合わせている。
// 税制が変わった年は、国税庁の「年末調整のしかた」で確かめてもらう前提の目安。

export type YearEndInputs = {
  // 配偶者: なし / 配偶者控除(一般38万・老人48万) / 金額を入力(配偶者特別控除など)
  spouse: "none" | "general" | "elderly" | "custom";
  spouseAmount: number;
  // 扶養親族の人数
  dependentsGeneral: number; // 一般(16歳以上)38万
  dependentsSpecific: number; // 特定(19〜22歳)63万
  dependentsElderly: number; // 老人(70歳以上)48万
  dependentsElderlyLiving: number; // 同居老親等 58万
  // 保険料などの控除(申告書に書かれた控除額)
  lifeInsurance: number; // 生命保険料控除(最高12万)
  earthquakeInsurance: number; // 地震保険料控除(最高5万)
  socialDeclared: number; // 給与から引いていない社会保険料(国民年金など)
  smallBusiness: number; // 小規模企業共済等掛金(iDeCoなど)
  otherDeductions: number; // 障害者控除・寡婦・ひとり親・勤労学生など
  housingLoan: number; // 住宅借入金等特別控除額(税額から引く)
  // 前の勤め先の分(年の途中で入社した人)
  prevPay: number;
  prevSocial: number;
  prevTax: number;
};

export const EMPTY_INPUTS: YearEndInputs = {
  spouse: "none",
  spouseAmount: 0,
  dependentsGeneral: 0,
  dependentsSpecific: 0,
  dependentsElderly: 0,
  dependentsElderlyLiving: 0,
  lifeInsurance: 0,
  earthquakeInsurance: 0,
  socialDeclared: 0,
  smallBusiness: 0,
  otherDeductions: 0,
  housingLoan: 0,
  prevPay: 0,
  prevSocial: 0,
  prevTax: 0,
};

export const LIMITS: Partial<Record<keyof YearEndInputs, number>> = {
  lifeInsurance: 120_000,
  earthquakeInsurance: 50_000,
  dependentsGeneral: 20,
  dependentsSpecific: 20,
  dependentsElderly: 20,
  dependentsElderlyLiving: 20,
};

// 年末調整をしない上限(給与の収入金額)
export const MAX_PAY = 20_000_000;

// 給与所得控除後の金額。660万円未満は4,000円単位に切り捨ててから計算する(所得税法別表第五と同じ)
export function employmentIncome(pay: number) {
  if (pay < 651_000) return 0;
  if (pay < 1_900_000) return pay - 650_000;
  if (pay < 6_600_000) {
    const a = Math.floor(pay / 4000) * 4000;
    return Math.floor(a <= 3_600_000 ? a * 0.7 - 80_000 : a * 0.8 - 440_000);
  }
  if (pay < 8_500_000) return Math.floor(pay * 0.9 - 1_100_000);
  return pay - 1_950_000;
}

// 基礎控除(合計所得金額に応じて)。132万超655万以下の上乗せは令和7・8年分だけ
export function basicDeduction(income: number, year: number) {
  if (income <= 1_320_000) return 950_000;
  if (year <= 2026) {
    if (income <= 3_360_000) return 880_000;
    if (income <= 4_890_000) return 680_000;
    if (income <= 6_550_000) return 630_000;
  }
  if (income <= 23_500_000) return 580_000;
  if (income <= 24_000_000) return 480_000;
  if (income <= 24_500_000) return 320_000;
  if (income <= 25_000_000) return 160_000;
  return 0;
}

// 所得税の速算表
export function incomeTaxOn(taxable: number) {
  const table: [number, number, number][] = [
    [1_949_000, 0.05, 0],
    [3_299_000, 0.1, 97_500],
    [6_949_000, 0.2, 427_500],
    [8_999_000, 0.23, 636_000],
    [17_999_000, 0.33, 1_536_000],
    [39_999_000, 0.4, 2_796_000],
    [Infinity, 0.45, 4_796_000],
  ];
  const [, rate, minus] = table.find(([max]) => taxable <= max)!;
  return Math.max(0, Math.floor(taxable * rate - minus));
}

export function spouseDeduction(inputs: YearEndInputs) {
  if (inputs.spouse === "general") return 380_000;
  if (inputs.spouse === "elderly") return 480_000;
  if (inputs.spouse === "custom") return inputs.spouseAmount;
  return 0;
}

export type Paid = { pay: number; social: number; tax: number };

export function calcYearEnd(paid: Paid, inputs: YearEndInputs, year: number) {
  const pay = paid.pay + inputs.prevPay;
  const income = employmentIncome(pay);
  const social = paid.social + inputs.prevSocial + inputs.socialDeclared;
  const dependents = inputs.dependentsGeneral * 380_000 + inputs.dependentsSpecific * 630_000 + inputs.dependentsElderly * 480_000 + inputs.dependentsElderlyLiving * 580_000;
  const basic = basicDeduction(income, year);
  const spouse = spouseDeduction(inputs);
  const deductions = social + inputs.smallBusiness + inputs.lifeInsurance + inputs.earthquakeInsurance + spouse + dependents + basic + inputs.otherDeductions;
  const taxable = Math.max(0, Math.floor((income - deductions) / 1000) * 1000);
  const computed = incomeTaxOn(taxable);
  const housing = Math.min(computed, inputs.housingLoan);
  // 復興特別所得税(2.1%)を含めて、100円未満を切り捨てる
  const annualTax = Math.floor(((computed - housing) * 1.021) / 100) * 100;
  const withheld = paid.tax + inputs.prevTax;
  return {
    pay,
    income,
    social,
    smallBusiness: inputs.smallBusiness,
    lifeInsurance: inputs.lifeInsurance,
    earthquakeInsurance: inputs.earthquakeInsurance,
    spouse,
    dependents,
    basic,
    other: inputs.otherDeductions,
    deductions,
    taxable,
    computed,
    housing,
    annualTax,
    withheld,
    // プラスなら本人に返す(還付)、マイナスなら追加で徴収する
    difference: withheld - annualTax,
  };
}

export type YearEndResult = ReturnType<typeof calcYearEnd>;

// 画面・APIから来た値を、数値の入った申告にそろえる
export function normalizeInputs(raw: unknown): YearEndInputs {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...EMPTY_INPUTS };
  for (const key of Object.keys(EMPTY_INPUTS) as (keyof YearEndInputs)[]) {
    if (key === "spouse") {
      const v = String(src.spouse ?? "none");
      out.spouse = (["none", "general", "elderly", "custom"].includes(v) ? v : "none") as YearEndInputs["spouse"];
      continue;
    }
    const n = Number(String(src[key] ?? "0").replaceAll(",", "").trim() || 0);
    const max = LIMITS[key] ?? 100_000_000;
    (out[key] as number) = Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : 0;
  }
  return out;
}
