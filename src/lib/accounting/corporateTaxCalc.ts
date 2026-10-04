// 法人税等の目安計算(画面でもサーバーでも使う、DBに触らない計算だけ)。
// 標準税率で計算する。都道府県・市町村の超過税率、外形標準課税の付加価値割・資本割、
// 税額控除などは含まない(申告は税理士に確認してもらう前提の目安)。

export type CorporateTaxInput = {
  addBack: number; // その他の加算(役員賞与・罰金など、損金にならないもの)
  deduction: number; // 減算(受取配当の益金不算入など)
  lossCarryforward: number; // 使える繰越欠損金
  perCapita: number; // 住民税の均等割(年額)
  months: number; // 事業年度の月数
};

export type CorporateTaxBase = {
  pretax: number; // 税引前当期純利益(法人税等の科目を除く)
  entertainment: number; // 接待交際費
  capital: number; // 資本金
};

export const DEFAULT_TAX_INPUT: CorporateTaxInput = { addBack: 0, deduction: 0, lossCarryforward: 0, perCapita: 70_000, months: 12 };

const SMALL_CAPITAL = 100_000_000; // 資本金1億円以下は中小法人
const floor100 = (n: number) => Math.max(0, Math.floor(n / 100) * 100);
const floor1000 = (n: number) => Math.max(0, Math.floor(n / 1000) * 1000);

export function calcCorporateTax(base: CorporateTaxBase, input: CorporateTaxInput) {
  const m = input.months;
  const small = base.capital <= SMALL_CAPITAL;

  // 交際費: 中小法人は年800万円(月数で按分)まで損金、大きい会社は飲食費の50%だけ(ここでは半分を損金にならない額とする)
  const entertainmentLimit = Math.floor((8_000_000 * m) / 12);
  const entertainmentExcess = small ? Math.max(0, base.entertainment - entertainmentLimit) : Math.floor(Math.max(0, base.entertainment) / 2);

  const income = base.pretax + entertainmentExcess + input.addBack - input.deduction; // 所得金額(欠損金の控除前)
  // 繰越欠損金: 中小法人は所得の全額まで、それ以外は所得の50%まで
  const lossUsed = income > 0 ? Math.min(input.lossCarryforward, small ? income : Math.floor(income / 2)) : 0;
  const taxable = floor1000(income - lossUsed); // 課税所得(千円未満切り捨て)

  // 法人税: 中小法人は年800万円以下の部分 15%、超える部分 23.2%
  const band = Math.floor((8_000_000 * m) / 12);
  const corporate = floor100(small ? Math.min(taxable, band) * 0.15 + Math.max(0, taxable - band) * 0.232 : taxable * 0.232);
  const corporateBase = floor1000(corporate);
  const localCorporate = floor100(corporateBase * 0.103); // 地方法人税 10.3%
  const inhabitantLevy = floor100(corporateBase * 0.07); // 住民税の法人税割 7.0%(標準税率)
  const perCapita = floor100((input.perCapita * m) / 12); // 住民税の均等割(赤字でもかかる)

  // 事業税(所得割): 中小法人は 年400万円以下 3.5%・400万〜800万円 5.3%・800万円超 7.0%。
  // 資本金1億円超は外形標準課税の所得割 1.0%(付加価値割・資本割は含まない)
  const b1 = Math.floor((4_000_000 * m) / 12);
  const b2 = Math.floor((8_000_000 * m) / 12);
  const enterprise = floor100(
    small ? Math.min(taxable, b1) * 0.035 + Math.min(Math.max(0, taxable - b1), b2 - b1) * 0.053 + Math.max(0, taxable - b2) * 0.07 : taxable * 0.01,
  );
  const specialEnterprise = floor100(enterprise * (small ? 0.37 : 2.6)); // 特別法人事業税

  const total = corporate + localCorporate + inhabitantLevy + perCapita + enterprise + specialEnterprise;
  return {
    small,
    entertainmentLimit,
    entertainmentExcess,
    income,
    lossUsed,
    taxable,
    corporate,
    localCorporate,
    inhabitantLevy,
    perCapita,
    enterprise,
    specialEnterprise,
    total,
    // 税引前当期純利益に対する税金の割合(実効税率の目安)
    rate: base.pretax > 0 ? total / base.pretax : null,
  };
}

export type CorporateTaxResult = ReturnType<typeof calcCorporateTax>;
