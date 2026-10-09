// 相見積の比較(画面とサーバーの両方で使う)。仕入先から届いた見積の文章から明細・送料・値引・納期などを読み取り、
// 税込の合計・品目ごとの単価を並べて、いちばん安い見積と差額を出す。決まったルールだけで動く(AIは読み取りの補助)。

export type QuoteLine = { description: string; quantity: number; unit: string | null; unitPrice: number };
export type ParsedQuote = {
  lines: QuoteLine[];
  shipping: number;
  discount: number;
  taxIncluded: boolean;
  delivery: string | null;
  validUntil: string | null;
  paymentTerms: string | null;
  statedTotal: number | null;
};
export type ComparedQuote = ParsedQuote & {
  vendor: string;
  subtotal: number; // 税抜(送料・値引を含む)
  tax: number;
  total: number; // 税込
  warnings: string[];
  mode: "claude" | "template";
};

const TAX = 0.1;
const UNITS = "個|台|本|枚|式|箱|セット|冊|件|袋|ケース|ロール|時間|人|回|ヶ月|か月|ヵ月|月|kg|g|m|L|丁|足|着|部|缶|巻|脚|食|名|日";
const NUM_TOKEN = new RegExp(`^(?:単価|数量|金額|@|¥)?\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNITS})?\\s*(?:円)?$`);
const SKIP = /^(?:お?見積|見積番号|見積日|件名|御中|様|担当|TEL|FAX|電話|〒|住所|登録番号|下記の通り|下記のとおり|備考|以上|毎度|いつも|よろしく)/;

const norm = (s: string) => s.normalize("NFKC").replace(/(\d),(?=\d{3})/g, "$1").replace(/[¥\\]/g, "¥");
const amountIn = (line: string) => {
  const m = norm(line).match(/(\d+)\s*円|¥\s*(\d+)|(\d{3,})/);
  return m ? Number(m[1] ?? m[2] ?? m[3]) : null;
};
const after = (line: string, word: RegExp) =>
  norm(line)
    .replace(word, "")
    .replace(/^[\s:]+/, "")
    .trim()
    .slice(0, 60) || null;

// 見積の文章を読む(1行に1品目。「品名 数量 単価 金額」のような並びを想定)
export function parseQuoteText(text: string): ParsedQuote {
  const out: ParsedQuote = { lines: [], shipping: 0, discount: 0, taxIncluded: false, delivery: null, validUntil: null, paymentTerms: null, statedTotal: null };
  const all = norm(text);
  out.taxIncluded = /税込|内税|消費税込/.test(all) && !/税抜|税別|外税/.test(all);
  for (const raw of all.split(/\r?\n/)) {
    const line = raw
      .replace(/[|｜\t]/g, " ")
      // 「(税込)」「(税抜)」などの書き添えは外す(税込かどうかは文全体で見る)
      .replace(/\((?:税込|税抜|税別|内税|外税)\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    if (/^(?:納期|納品日|お届け)/.test(line)) {
      out.delivery = after(line, /^(?:納期|納品日|お届け日?)/);
      continue;
    }
    if (/^(?:有効期限|見積有効期限|有効期間)/.test(line)) {
      out.validUntil = after(line, /^(?:見積)?有効(?:期限|期間)/);
      continue;
    }
    if (/^(?:支払条件|お支払|支払方法|支払い)/.test(line)) {
      out.paymentTerms = after(line, /^(?:支払条件|お支払(?:い)?(?:条件|方法)?|支払方法|支払い(?:条件)?)/);
      continue;
    }
    if (/^(?:送料|配送料|運賃|配送費|運送費)/.test(line)) {
      out.shipping += amountIn(line.replace(/^\S+/, "")) ?? 0;
      continue;
    }
    if (/^(?:値引|割引|お値引|出精値引)/.test(line)) {
      out.discount += amountIn(line.replace(/^\S+/, "").replace(/-/g, "")) ?? 0;
      continue;
    }
    if (/^(?:合計|総額|お見積金額|御見積金額|見積金額|税込合計|総合計)/.test(line)) {
      out.statedTotal = amountIn(line.replace(/^\S+/, "")) ?? out.statedTotal;
      continue;
    }
    if (/^(?:小計|消費税|税額|内消費税)/.test(line) || SKIP.test(line)) continue;
    // 「10 箱」のように数と単位が離れていたらつなげる
    const tokens = line
      .replace(new RegExp(`(\\d) (${UNITS})(?= |$)`, "g"), "$1$2")
      .split(" ")
      .filter((t) => t && t !== "×" && t !== "x" && t !== "@");
    const firstNum = tokens.findIndex((t, i) => i > 0 && NUM_TOKEN.test(t));
    if (firstNum < 1) continue;
    const description = tokens.slice(0, firstNum).join(" ").replace(/[:・-]+$/, "").trim();
    const nums = tokens
      .slice(firstNum)
      .map((t) => t.match(NUM_TOKEN))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ n: Number(m[1]), unit: m[2] ?? null }));
    if (!description || !nums.length) continue;
    let quantity = 1;
    let unit: string | null = null;
    let unitPrice = 0;
    if (nums.length >= 3) {
      quantity = nums[0].n;
      unit = nums[0].unit;
      unitPrice = nums[1].n;
    } else if (nums.length === 2) {
      // 1つ目に単位がついている・小さい数なら「数量 単価」、どちらも大きければ「単価 金額」
      if (nums[0].unit || nums[0].n < 1000) {
        quantity = nums[0].n;
        unit = nums[0].unit;
        unitPrice = nums[1].n;
      } else {
        unitPrice = nums[0].n;
        quantity = nums[0].n ? Math.round((nums[1].n / nums[0].n) * 100) / 100 : 1;
      }
    } else {
      // 数が1つだけで単位がついていれば数量なので、値段がわからない行として飛ばす
      if (nums[0].unit) continue;
      unit = "式";
      unitPrice = nums[0].n;
    }
    if (!(quantity > 0) || !Number.isFinite(unitPrice)) continue;
    out.lines.push({ description: description.slice(0, 80), quantity, unit, unitPrice: Math.round(unitPrice) });
    if (out.lines.length >= 50) break;
  }
  return out;
}

// 税抜・税込の合計と、読み取りの注意
export function totalsOf(vendor: string, q: ParsedQuote, mode: "claude" | "template" = "template"): ComparedQuote {
  const items = q.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice), 0);
  const gross = items + q.shipping - q.discount;
  let subtotal: number;
  let tax: number;
  let total: number;
  if (q.taxIncluded) {
    total = gross;
    subtotal = Math.round(gross / (1 + TAX));
    tax = total - subtotal;
  } else {
    subtotal = gross;
    tax = Math.floor(gross * TAX);
    total = subtotal + tax;
  }
  const warnings: string[] = [];
  if (!q.lines.length) warnings.push("明細を読み取れませんでした。「品名 数量 単価」の並びで1行ずつ書いてください");
  if (q.statedTotal !== null && q.lines.length && Math.abs(q.statedTotal - total) > 1 && Math.abs(q.statedTotal - subtotal) > 1)
    warnings.push(`書いてある合計(${q.statedTotal.toLocaleString()}円)と明細からの計算(税込${total.toLocaleString()}円)が合いません。読み取りを確かめてください`);
  if (!q.delivery) warnings.push("納期が書いてありません");
  return { ...q, vendor, subtotal, tax, total, warnings, mode };
}

// 品目の名前をそろえる(全角・大文字小文字・空白・記号の違いを無視)
export const itemKey = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s()「」・\-_/、。,.]/g, "");

// 前に発注したときの単価(税抜)
export type PastPrice = { unitPrice: number; date: string; vendor: string };
export type CompareRow = { key: string; description: string; prices: (number | null)[]; quantities: (number | null)[]; lowest: number | null; last: PastPrice | null };
export type Comparison = {
  quotes: ComparedQuote[];
  rows: CompareRow[];
  best: number | null; // いちばんおすすめの見積(quotes の番号)
  cheapest: number | null;
  summary: string[];
};

// history: 品目(itemKey)ごとの前回の発注単価
export function compareQuotes(quotes: ComparedQuote[], history: ReadonlyMap<string, PastPrice> = new Map()): Comparison {
  const rows: CompareRow[] = [];
  const find = (k: string) => rows.find((r) => r.key === k || (k.length >= 3 && r.key.length >= 3 && (r.key.includes(k) || k.includes(r.key))));
  quotes.forEach((q, qi) => {
    for (const l of q.lines) {
      const k = itemKey(l.description);
      if (!k) continue;
      let row = find(k);
      if (!row) {
        row = { key: k, description: l.description, prices: quotes.map(() => null), quantities: quotes.map(() => null), lowest: null, last: null };
        rows.push(row);
      }
      if (row.prices[qi] === null) {
        // 税込の見積は税抜にそろえて比べる
        row.prices[qi] = q.taxIncluded ? Math.round(l.unitPrice / (1 + TAX)) : l.unitPrice;
        row.quantities[qi] = l.quantity;
      }
    }
  });
  const pastOf = (k: string) => {
    const hit = history.get(k);
    if (hit) return hit;
    if (k.length < 3) return null;
    for (const [hk, v] of history) if (hk.length >= 3 && (hk.includes(k) || k.includes(hk))) return v;
    return null;
  };
  for (const r of rows) {
    const vals = r.prices.filter((p): p is number => p !== null);
    r.lowest = vals.length >= 2 ? Math.min(...vals) : null;
    r.last = pastOf(r.key);
  }
  const usable = quotes.map((q, i) => ({ q, i })).filter(({ q }) => q.lines.length > 0);
  const cover = (i: number) => rows.filter((r) => r.prices[i] !== null).length;
  const maxCover = Math.max(0, ...usable.map(({ i }) => cover(i)));
  const byTotal = [...usable].sort((a, b) => a.q.total - b.q.total);
  const cheapest = byTotal[0]?.i ?? null;
  const full = byTotal.filter(({ i }) => cover(i) === maxCover);
  const best = full[0]?.i ?? cheapest;
  const summary: string[] = [];
  const yen = (n: number) => `${n.toLocaleString()}円`;
  if (usable.length < 2) summary.push("2社以上の見積を読み取れると比べられます。");
  else if (best !== null) {
    const b = quotes[best];
    // 比べる相手は、おすすめより高い見積のうちいちばん安いもの
    const next = byTotal.find(({ i, q }) => i !== best && q.total >= b.total);
    summary.push(`税込の合計がいちばん安いのは${quotes[cheapest!].vendor}(${yen(quotes[cheapest!].total)})です。`);
    if (best !== cheapest)
      summary.push(`ただし${quotes[cheapest!].vendor}の見積は品目がそろっていません(${cover(cheapest!)}/${rows.length}品目)。品目がそろっている中では${b.vendor}(${yen(b.total)})がいちばん安いです。`);
    else if (cover(best) < rows.length) summary.push(`${b.vendor}の見積にない品目があります(${cover(best)}/${rows.length}品目)。足りない品目を確かめてください。`);
    // 品目がそろっていないときは、全社にある品目だけでも比べる(税抜)
    const common = rows.filter((r) => usable.every(({ i }) => r.prices[i] !== null));
    if (common.length && common.length < rows.length) {
      const sums = usable
        .map(({ q, i }) => ({ q, sum: common.reduce((s, r) => s + Math.round(r.prices[i]! * (r.quantities[i] ?? 1)), 0) }))
        .sort((x, y) => x.sum - y.sum);
      summary.push(`全社にある${common.length}品目だけで比べると、いちばん安いのは${sums[0].q.vendor}(税抜${yen(sums[0].sum)})です。`);
    }
    if (next && next.q.total >= b.total) {
      const diff = next.q.total - b.total;
      if (diff > 0) summary.push(`次に安い${next.q.vendor}(${yen(next.q.total)})との差は${yen(diff)}(${Math.round((diff / next.q.total) * 1000) / 10}%)です。`);
      else if (diff === 0) summary.push(`${b.vendor}と${next.q.vendor}は同じ金額です(税込)。納期や支払条件で選んでください。`);
    }
    const cheaperItems = rows.filter((r) => r.lowest !== null && r.prices[best] !== null && r.prices[best]! > r.lowest);
    if (cheaperItems.length)
      summary.push(`品目ごとでは、${cheaperItems
        .slice(0, 3)
        .map((r) => r.description)
        .join("・")}は他社のほうが安いです(分けて頼むと安くなるかもしれません)。`);
    if (b.shipping > 0) summary.push(`${b.vendor}は送料${yen(b.shipping)}が合計に入っています。`);
    // 前回の発注より5%以上変わった品目
    const moved = rows
      .filter((r) => r.last && r.prices[best] !== null && r.last.unitPrice > 0)
      .map((r) => ({ r, pct: Math.round(((r.prices[best]! - r.last!.unitPrice) / r.last!.unitPrice) * 1000) / 10 }))
      .filter((x) => Math.abs(x.pct) >= 5);
    const up = moved.filter((x) => x.pct > 0);
    const down = moved.filter((x) => x.pct < 0);
    const fmt = (x: (typeof moved)[number]) => `${x.r.description}(前回${yen(x.r.last!.unitPrice)}→${yen(x.r.prices[best]!)}、${x.pct > 0 ? "+" : ""}${x.pct}%)`;
    if (up.length) summary.push(`${b.vendor}の見積で、前回の発注より高くなった品目: ${up.slice(0, 3).map(fmt).join("・")}。値下げの相談の材料にできます。`);
    if (down.length) summary.push(`前回の発注より安くなった品目: ${down.slice(0, 3).map(fmt).join("・")}。`);
  }
  return { quotes, rows, best, cheapest, summary };
}

// 納期の文から日付を読む(「2026/10/30」「10月30日」)。読めなければ null
export function deliveryDate(text: string | null, today: string): string | null {
  if (!text) return null;
  const t = norm(text);
  const full = t.match(/(20\d{2})[/年.-](\d{1,2})[/月.-](\d{1,2})/);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (full) return `${full[1]}-${pad(Number(full[2]))}-${pad(Number(full[3]))}`;
  const md = t.match(/(\d{1,2})[/月](\d{1,2})日?/);
  if (md) {
    const y = Number(today.slice(0, 4));
    const key = `${y}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`;
    return key >= today ? key : `${y + 1}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`;
  }
  return null;
}
