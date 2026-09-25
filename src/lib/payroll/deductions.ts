// 給与の控除(社会保険料・雇用保険料・源泉所得税)の計算。DB を使わない純粋な計算だけを置く。
// いずれも「目安」: 標準報酬月額は本来4〜6月の平均で年1回決まり、保険料率は都道府県・年度で変わる。

// 健康保険の標準報酬月額の等級(協会けんぽ 1〜50等級)。[標準報酬月額, この金額未満までが該当]
const HEALTH_GRADES: [number, number][] = [
  [58_000, 63_000], [68_000, 73_000], [78_000, 83_000], [88_000, 93_000], [98_000, 101_000], [104_000, 107_000],
  [110_000, 114_000], [118_000, 122_000], [126_000, 130_000], [134_000, 138_000], [142_000, 146_000], [150_000, 155_000],
  [160_000, 165_000], [170_000, 175_000], [180_000, 185_000], [190_000, 195_000], [200_000, 210_000], [220_000, 230_000],
  [240_000, 250_000], [260_000, 270_000], [280_000, 290_000], [300_000, 310_000], [320_000, 330_000], [340_000, 350_000],
  [360_000, 370_000], [380_000, 395_000], [410_000, 425_000], [440_000, 455_000], [470_000, 485_000], [500_000, 515_000],
  [530_000, 545_000], [560_000, 575_000], [590_000, 605_000], [620_000, 635_000], [650_000, 665_000], [680_000, 695_000],
  [710_000, 730_000], [750_000, 770_000], [790_000, 810_000], [830_000, 855_000], [880_000, 905_000], [930_000, 955_000],
  [980_000, 1_005_000], [1_030_000, 1_055_000], [1_090_000, 1_115_000], [1_150_000, 1_175_000], [1_210_000, 1_235_000],
  [1_270_000, 1_295_000], [1_330_000, 1_355_000], [1_390_000, Infinity],
];
const PENSION_MIN = 88_000;
const PENSION_MAX = 650_000;

export function healthStandard(monthlyPay: number) {
  return HEALTH_GRADES.find(([, below]) => monthlyPay < below)![0];
}

// 厚生年金は 88,000〜650,000 円の範囲(健康保険の等級を上下で切る)
export function pensionStandard(healthStd: number) {
  return Math.min(PENSION_MAX, Math.max(PENSION_MIN, healthStd));
}

// 給与から控除する本人負担分: 50銭以下は切り捨て、50銭を超えたら切り上げ
export function employeeShare(amount: number) {
  const floor = Math.floor(amount);
  return amount - floor > 0.5 ? floor + 1 : floor;
}

export type Rates = { health: number; care: number; pension: number; employment: number }; // 単位 0.001%
// 金額×料率。整数どうしを掛けてから割り、小数の誤差(31711.999… など)が出ないようにする
const times = (amount: number, rate: number) => (amount * rate) / 100_000;

// ---- 源泉所得税(月額表・甲欄)。国税庁の「電子計算機等を使用して源泉徴収税額を計算する方法」の式で計算する目安 ----
// 令和8年分の給与所得控除(最低65万円)・基礎控除(58万円)を月額にして使う。

function salaryDeduction(a: number) {
  if (a <= 158_333) return 54_167;
  if (a <= 299_999) return Math.ceil(a * 0.3 + 6_667);
  if (a <= 549_999) return Math.ceil(a * 0.2 + 36_667);
  if (a <= 708_330) return Math.ceil(a * 0.1 + 91_667);
  return 162_500;
}

function basicDeduction(a: number) {
  if (a <= 1_958_333) return 48_334;
  if (a <= 2_000_000) return 40_000;
  if (a <= 2_041_666) return 26_667;
  if (a <= 2_083_333) return 13_334;
  return 0;
}

const DEPENDENT_DEDUCTION = 31_667; // 扶養親族等1人あたり(月額)

// a: その月の社会保険料等を差し引いた後の給与等の金額
export function withholdingKou(a: number, dependents: number) {
  if (a <= 0) return 0;
  const taxable = Math.floor(a - salaryDeduction(a) - DEPENDENT_DEDUCTION * Math.max(0, dependents) - basicDeduction(a));
  if (taxable <= 0) return 0;
  const tax =
    taxable <= 162_500
      ? taxable * 0.05105
      : taxable <= 275_000
        ? taxable * 0.1021 - 8_296
        : taxable <= 579_166
          ? taxable * 0.2042 - 36_374
          : taxable <= 750_000
            ? taxable * 0.23483 - 54_113
            : taxable <= 1_500_000
              ? taxable * 0.33693 - 130_688
              : taxable <= 3_333_333
                ? taxable * 0.4084 - 237_893
                : taxable * 0.45945 - 408_061;
  return Math.max(0, Math.round(tax / 10) * 10); // 10円未満四捨五入
}

// 乙欄(扶養控除等申告書を出していない人)。88,000円未満は3.063%。それ以上は税額表で確かめて手で入れてもらう。
export function withholdingOtsu(a: number): number | null {
  if (a <= 0) return 0;
  if (a < 88_000) return Math.floor(a * 0.03063);
  return null;
}

export type StaffPayrollSettings = {
  dependents: number;
  taxColumn: string;
  socialInsurance: boolean;
  careInsurance: boolean;
  employmentInsurance: boolean;
  standardMonthly: number | null;
  commuteAllowance: number;
  residentTax: number;
};

export type Deductions = {
  wages: number; // シフトから計算した給与(課税)
  commute: number; // 通勤手当(非課税)
  gross: number; // 総支給額
  standardMonthly: number | null;
  standardEstimated: boolean;
  health: number;
  care: number;
  pension: number;
  employment: number;
  socialTotal: number;
  taxableAfterSocial: number;
  incomeTax: number;
  incomeTaxNeedsInput: boolean; // 乙欄で税額表の確認が必要
  incomeTaxOverridden: boolean;
  residentTax: number;
  totalDeductions: number;
  netPay: number;
  employerSocial: number; // 会社負担の健康保険・介護・厚生年金
};

export function calcDeductions(wages: number, s: StaffPayrollSettings, rates: Rates, override: number | null): Deductions {
  const commute = Math.max(0, s.commuteAllowance);
  const gross = wages + commute;
  let standardMonthly: number | null = null;
  let health = 0;
  let care = 0;
  let pension = 0;
  let employerSocial = 0;
  if (s.socialInsurance) {
    standardMonthly = s.standardMonthly ?? healthStandard(gross);
    const healthTotal = times(standardMonthly, rates.health);
    const careTotal = s.careInsurance ? times(standardMonthly, rates.care) : 0;
    const pensionTotal = times(pensionStandard(standardMonthly), rates.pension);
    health = employeeShare(healthTotal / 2);
    care = employeeShare(careTotal / 2);
    pension = employeeShare(pensionTotal / 2);
    employerSocial = Math.floor(healthTotal) - health + (Math.floor(careTotal) - care) + (Math.floor(pensionTotal) - pension);
  }
  const employment = s.employmentInsurance ? employeeShare(times(gross, rates.employment)) : 0;
  const socialTotal = health + care + pension + employment;
  // 通勤手当(月15万円まで非課税)と社会保険料を引いた額に税金がかかる
  const taxableAfterSocial = Math.max(0, gross - Math.min(commute, 150_000) - socialTotal);
  const computed = s.taxColumn === "OTSU" ? withholdingOtsu(taxableAfterSocial) : withholdingKou(taxableAfterSocial, s.dependents);
  const incomeTax = override ?? computed ?? 0;
  const residentTax = Math.max(0, s.residentTax);
  const totalDeductions = socialTotal + incomeTax + residentTax;
  return {
    wages,
    commute,
    gross,
    standardMonthly,
    standardEstimated: s.socialInsurance && s.standardMonthly === null,
    health,
    care,
    pension,
    employment,
    socialTotal,
    taxableAfterSocial,
    incomeTax,
    incomeTaxNeedsInput: override === null && computed === null,
    incomeTaxOverridden: override !== null,
    residentTax,
    totalDeductions,
    netPay: gross - totalDeductions,
    employerSocial: Math.max(0, employerSocial),
  };
}
