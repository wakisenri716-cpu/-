// AIの書いた文に、元の情報にない数字(金額・日付・番号・割合)がないかを確かめる。
// ・2けた以上の数は、元の情報のどこかに出てくればよい
// ・単位つきの数(%・割・か月など)は、日付の数字と取り違えないように単位ごと照らし合わせる。円は、元の情報に同じ数(3けた以上)があればよい
const norm = (s: string) => s.normalize("NFKC").replace(/(\d),(?=\d{3})/g, "$1");
const plain = (s: string) => norm(s).match(/\d{2,}/g) ?? [];
const UNIT = /(\d+(?:\.\d+)?)\s*(%|円|割|万円|か月|ヶ月|日間|営業日|年間)/g;

export function inventedNumbers(output: string, source: string): string[] {
  const src = norm(source);
  const nums = new Set(plain(src));
  const units = new Set([...src.matchAll(UNIT)].map((m) => `${m[1]}${m[2]}`));
  const out: string[] = [];
  for (const n of plain(output)) if (!nums.has(n)) out.push(n);
  for (const m of norm(output).matchAll(UNIT)) {
    const token = `${m[1]}${m[2]}`;
    if (units.has(token)) continue;
    if (m[2] === "円" && m[1].length >= 3 && nums.has(m[1])) continue;
    out.push(token);
  }
  return [...new Set(out)];
}
