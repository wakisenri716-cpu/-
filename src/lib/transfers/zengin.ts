import { encodeShiftJis } from "@/lib/sjis";

// 全銀協フォーマット(総合振込・給与振込)。1行120文字の固定長で、名前は半角カナ・英大文字・数字と一部の記号だけ使える。

// ---- 半角カナへの変換 ----

const FULL = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const HALF = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ";
// 濁音・半濁音は2文字(ﾞﾟ)に分ける
const VOICED: Record<string, string> = {};
"ガギグゲゴザジズゼゾダヂヅデドバビブベボ".split("").forEach((ch, i) => (VOICED[ch] = `${"ｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾊﾋﾌﾍﾎ"[i]}ﾞ`));
"パピプペポ".split("").forEach((ch, i) => (VOICED[ch] = `${"ﾊﾋﾌﾍﾎ"[i]}ﾟ`));
VOICED["ヴ"] = "ｳﾞ";
// 全銀では小さい文字は使えないので、大きい文字にする
const SMALL: Record<string, string> = { ァ: "ｱ", ィ: "ｲ", ゥ: "ｳ", ェ: "ｴ", ォ: "ｵ", ッ: "ﾂ", ャ: "ﾔ", ュ: "ﾕ", ョ: "ﾖ", ヮ: "ﾜ", ヵ: "ｶ", ヶ: "ｹ", ｧ: "ｱ", ｨ: "ｲ", ｩ: "ｳ", ｪ: "ｴ", ｫ: "ｵ", ｯ: "ﾂ", ｬ: "ﾔ", ｭ: "ﾕ", ｮ: "ﾖ" };
const ALLOWED = /^[0-9A-Z ｱ-ﾝﾞﾟ().,/\-]*$/;

export function toZenginKana(input: string) {
  // 半角カナを全角に(NFKC)、全角英数を半角に、ひらがなをカタカナにしてから、半角カナへ
  const text = input
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .toUpperCase();
  let out = "";
  for (const ch of text) {
    if (SMALL[ch]) out += SMALL[ch];
    else if (VOICED[ch]) out += VOICED[ch];
    else if (FULL.includes(ch)) out += HALF[FULL.indexOf(ch)];
    else if (ch === "ー" || ch === "−" || ch === "‐" || ch === "―") out += "-";
    else if (ch === "　" || ch === " ") out += " ";
    else if (ch === "・") out += ".";
    else if (ch === "（") out += "(";
    else if (ch === "）") out += ")";
    else out += ch;
  }
  return out.replace(/ +/g, " ").trim();
}

export function isZenginKana(text: string) {
  return ALLOWED.test(text);
}

// ---- 口座 ----

export type Account = {
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: "1" | "2"; // 1 普通 / 2 当座
  accountNumber: string;
  holder?: string; // 受取人名(半角カナ)
};

export type Source = Omit<Account, "holder"> & { requesterCode: string; requesterName: string };

export const ACCOUNT_TYPE_LABELS: Record<string, string> = { "1": "普通", "2": "当座", "4": "貯蓄" };

// ---- 固定長の欄 ----

const num = (value: string | number, width: number) => String(value).padStart(width, "0").slice(-width);
const text = (value: string, width: number) => {
  const v = value.slice(0, width);
  return v + " ".repeat(width - v.length);
};

export type TransferKind = "GENERAL" | "SALARY" | "BONUS";
const KIND_CODE: Record<TransferKind, string> = { GENERAL: "21", SALARY: "11", BONUS: "12" };

export type TransferLine = { account: Account; amount: number; customerCode?: string };

// 取組日(振込日)は MMDD
export function buildZenginFile(kind: TransferKind, source: Source, transferDate: string, lines: TransferLine[]) {
  const [, mm, dd] = transferDate.split("-");
  const header =
    "1" +
    KIND_CODE[kind] +
    "0" +
    num(source.requesterCode, 10) +
    text(source.requesterName, 40) +
    mm +
    dd +
    num(source.bankCode, 4) +
    text(source.bankName, 15) +
    num(source.branchCode, 3) +
    text(source.branchName, 15) +
    source.accountType +
    num(source.accountNumber, 7) +
    text("", 17);
  const data = lines.map(
    (l) =>
      "2" +
      num(l.account.bankCode, 4) +
      text(l.account.bankName, 15) +
      num(l.account.branchCode, 3) +
      text(l.account.branchName, 15) +
      text("", 4) +
      l.account.accountType +
      num(l.account.accountNumber, 7) +
      text(l.account.holder ?? "", 30) +
      num(l.amount, 10) +
      "0" +
      text(l.customerCode ?? "", 10) +
      text("", 10) +
      (kind === "GENERAL" ? "7" : " ") +
      " " +
      text("", 7),
  );
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const trailer = "8" + num(lines.length, 6) + num(total, 12) + text("", 101);
  const end = "9" + text("", 119);
  const records = [header, ...data, trailer, end];
  for (const r of records) if (r.length !== 120) throw new Error(`全銀データの桁数が正しくありません(${r.length}桁)`);
  return encodeShiftJis(records.join("\r\n") + "\r\n");
}
