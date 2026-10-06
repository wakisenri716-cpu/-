// 決算までにできること(節税の選択肢)。画面でもサーバーでも使う、DBに触らない部分。
import { calcCorporateTax, type CorporateTaxBase, type CorporateTaxInput, type CorporateTaxResult } from "@/lib/accounting/corporateTaxCalc";

// 税の制度は変わることがあり、使えるかどうかは会社の条件で決まるので、どれも「目安」として出し、税理士に確かめてもらう前提。

export type SavingOption = { key: string; title: string; detail: string; caution: string; cashOut: boolean };

export const SAVING_OPTIONS: SavingOption[] = [
  {
    key: "bonus",
    title: "決算賞与(従業員へ)",
    detail: "期末までに支給額を各人に知らせ、期末から1か月以内に支払うなどの条件を満たすと、今期の費用にできます。",
    caution: "役員は対象外です。お金は出ていきます。社会保険料もかかります。",
    cashOut: true,
  },
  {
    key: "safety",
    title: "経営セーフティ共済(中小企業倒産防止共済)",
    detail: "掛金(月5,000円〜20万円)は全額費用にでき、1年分の前納もできます。取引先が倒産したときに借入ができます。",
    caution: "解約して戻ったお金は、その年の利益になります(税金の先送り)。加入の条件があります。",
    cashOut: true,
  },
  {
    key: "smallAssets",
    title: "少額の備品の購入",
    detail: "中小企業者等は、1つ30万円未満の備品(パソコン・家具など)を、決まった年の合計額まで、買った年に全額費用にできる特例があります。",
    caution: "本当に必要なものだけにしましょう。期末までに使い始める必要があります。特例の期限・条件は確かめてください。",
    cashOut: true,
  },
  {
    key: "prepaid",
    title: "短期前払費用(家賃・保守料などの前払い)",
    detail: "1年以内に受けるサービスの代金を前払いすると、払った年の費用にできる扱いがあります。",
    caution: "毎期続けることが条件です。来期の費用が減るので、来期の利益は増えます。",
    cashOut: true,
  },
  {
    key: "disposal",
    title: "使っていない資産・売れない在庫の処分",
    detail: "壊れた・使わない備品の除却や、売れない在庫の廃棄をすると、帳簿の残りの金額を費用にできます。",
    caution: "処分した証拠(写真・業者の書類など)を残しましょう。お金は出ていきません。",
    cashOut: false,
  },
];

export function parseOptionAmounts(input: unknown): Record<string, number> {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const o of SAVING_OPTIONS) {
    const n = Math.round(Number(raw[o.key] ?? 0));
    out[o.key] = Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000_000) : 0;
  }
  return out;
}

// 決算までにできることを入れたときの税金とお金の動き(税金は減っても、お金は出ていく)
export function applyOptions(f: { base: CorporateTaxBase; input: CorporateTaxInput; result: CorporateTaxResult; interim: number }, amounts: Record<string, number>) {
  const total = Object.values(amounts).reduce((s, v) => s + v, 0);
  const after = calcCorporateTax({ ...f.base, pretax: f.base.pretax - total }, f.input);
  const cashOut = SAVING_OPTIONS.filter((o) => o.cashOut).reduce((s, o) => s + (amounts[o.key] ?? 0), 0);
  const taxSaved = f.result.total - after.total;
  return { total, taxAfter: after.total, taxSaved, cashOut, netCash: taxSaved - cashOut, payableAfter: Math.max(0, after.total - f.interim) };
}
