// Shift_JIS への変換(弥生会計などの会計ソフトは Shift_JIS の CSV を読み込むため)。
// ライブラリを使わず、Node.js の TextDecoder で Shift_JIS の全文字を一度だけ読み、逆引きの表を作る。

let table: Map<string, number[]> | null = null;

function buildTable() {
  const map = new Map<string, number[]>();
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const add = (bytes: number[]) => {
    try {
      const ch = decoder.decode(new Uint8Array(bytes));
      if (ch.length === 1 && ch !== "�" && !map.has(ch)) map.set(ch, bytes);
    } catch {
      // 割り当てのない番号
    }
  };
  for (let b = 0xa1; b <= 0xdf; b++) add([b]); // 半角カナ
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) if (trail !== 0x7f) add([lead, trail]);
  }
  // 環境によって文字が変わる記号は、Windows でよく使われる方にそろえる
  const alias: [string, string][] = [["～", "〜"], ["－", "−"], ["￠", "¢"], ["￡", "£"], ["￢", "¬"], ["‖", "∥"], ["—", "―"]];
  for (const [a, b] of alias) {
    if (!map.has(a) && map.has(b)) map.set(a, map.get(b)!);
    if (!map.has(b) && map.has(a)) map.set(b, map.get(a)!);
  }
  return map;
}

// Shift_JIS にない文字(絵文字など)は「?」にする
export function encodeShiftJis(text: string): Buffer {
  table ??= buildTable();
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const bytes = table.get(ch);
    if (bytes) out.push(...bytes);
    else out.push(0x3f);
  }
  return Buffer.from(out);
}
