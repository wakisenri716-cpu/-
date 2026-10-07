import type { ReactNode } from "react";

// マニュアルの本文を、かんたんな書き方で整えて表示する。
//   # 見出し / ## 小見出し / - 箇条書き / 1. 手順 / **太字** / 「注意:」(英語版は「Caution:」)で始まる行は目立たせる
// HTMLは使わない(Reactがすべてエスケープする)ので、書いた文字がそのまま安全に表示される。

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

type Block = { kind: "h1" | "h2" | "p" | "note"; text: string } | { kind: "ul" | "ol"; items: string[] };

function parse(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) flush();
    else if ((m = line.match(/^##\s+(.*)/))) {
      flush();
      blocks.push({ kind: "h2", text: m[1] });
    } else if ((m = line.match(/^#\s+(.*)/))) {
      flush();
      blocks.push({ kind: "h1", text: m[1] });
    } else if ((m = line.match(/^\s*[-・*]\s+(.*)/))) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(m[1]);
      else blocks.push({ kind: "ul", items: [m[1]] });
    } else if ((m = line.match(/^\s*\d+[.)．]\s*(.*)/))) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ol") last.items.push(m[1]);
      else blocks.push({ kind: "ol", items: [m[1]] });
    } else if (/^(注意|重要|NG|Caution|Important|Warning)[:：]/i.test(line.trim())) {
      flush();
      blocks.push({ kind: "note", text: line.trim() });
    } else para.push(line);
  }
  flush();
  return blocks;
}

export function ManualBody({ body }: { body: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-slate-800">
      {parse(body).map((b, i) => {
        if (b.kind === "h1") return <h2 key={i} className="border-b pb-1 pt-2 text-lg font-semibold">{inline(b.text)}</h2>;
        if (b.kind === "h2") return <h3 key={i} className="pt-1 font-semibold text-indigo-800">{inline(b.text)}</h3>;
        if (b.kind === "note") return <p key={i} className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-amber-900">{inline(b.text)}</p>;
        if (b.kind === "ul") return <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>;
        if (b.kind === "ol")
          return (
            <ol key={i} className="space-y-2">
              {b.items.map((t, j) => (
                <li key={j} className="flex gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{j + 1}</span>
                  <span>{inline(t)}</span>
                </li>
              ))}
            </ol>
          );
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(b.kind === "p" ? b.text : "")}
          </p>
        );
      })}
    </div>
  );
}
