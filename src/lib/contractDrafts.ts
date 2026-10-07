import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";
import { formatYen } from "@/lib/format";

// 契約書のひな形: 秘密保持契約(NDA)・業務委託契約・取引基本契約を、当事者と条件から「第1条〜」の形で作る。
// 印紙・フリーランス法(特定受託事業者への委託)・支払期日などの確かめる点も出す。AIが使えるときは、会社の事情に合わせて条文を直す
// (入れた金額・期間・支払条件は変えない)。下書きは保存しないが、できたら「契約書の台帳」に登録できる。
// 法的な判断は一般的な目安。締結の前に弁護士などに確かめる前提。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ContractDraftKind = "NDA" | "OUTSOURCING" | "SALES";
export const DRAFT_KINDS: Record<ContractDraftKind, { title: string; description: string }> = {
  NDA: { title: "秘密保持契約書", description: "商談・共同の検討で見せ合う情報を、ほかに漏らさない・目的外に使わない約束。" },
  OUTSOURCING: { title: "業務委託契約書", description: "仕事を外に頼む(または頼まれる)ときの、業務内容・委託料・支払い・成果物の権利などのきまり。" },
  SALES: { title: "取引基本契約書", description: "継続して商品を売り買いするときの、注文・納品・検査・支払いの共通のきまり。" },
};

export type Article = { title: string; paragraphs: string[] };
export type DraftCheck = { level: "ng" | "warn" | "info"; text: string };

export type ContractInput = {
  kind: ContractDraftKind;
  counterparty: string;
  counterpartyAddress: string;
  ourRole: "CLIENT" | "CONTRACTOR"; // 業務委託: 頼む側 / 頼まれる側。取引基本: 買う側 / 売る側
  startDate: string;
  months: number;
  autoRenew: boolean;
  purpose: string; // NDA の目的
  mutual: boolean; // NDA: お互いに守る
  survivalYears: number; // NDA: 終わったあとも守る年数
  work: string; // 業務委託の内容 / 取引の品目
  fee: number | null;
  feeUnit: "MONTHLY" | "ONCE";
  paymentDays: number; // 受け取り(検収)から支払いまでの日数
  freelancer: boolean; // 相手が従業員を使わない個人・一人社長(フリーランス)
  ipToClient: boolean; // 成果物の権利を頼む側へ
  inspectionDays: number; // 検査の日数
  notes: string;
};

const str = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const int = (v: unknown, def: number, min: number, max: number, label: string) => {
  if (v === undefined || v === null || v === "") return def;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new UserError(`${label}を正しく入れてください`);
  return n;
};
const jpDate = (key: string) => `${Number(key.slice(0, 4))}年${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`;
const addMonthsMinusDay = (key: string, months: number) => {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
};

export function parseContractInput(raw: Record<string, unknown>): ContractInput {
  const kind = String(raw.kind ?? "") as ContractDraftKind;
  if (!Object.hasOwn(DRAFT_KINDS, kind)) throw new UserError("作る契約書を選んでください");
  const counterparty = str(raw.counterparty, 80).replace(/\n/g, " ");
  if (!counterparty) throw new UserError("相手方の名前を入れてください");
  const startDate = str(raw.startDate, 10) || jstDateKey(new Date());
  if (!DATE.test(startDate) || new Date(`${startDate}T00:00:00Z`).toISOString().slice(0, 10) !== startDate) throw new UserError("契約の開始日を正しく入れてください");
  const feeRaw = raw.fee === undefined || raw.fee === null || raw.fee === "" ? null : Math.round(Number(raw.fee));
  if (feeRaw !== null && (!Number.isFinite(feeRaw) || feeRaw < 0 || feeRaw > 10_000_000_000)) throw new UserError("委託料を正しく入れてください");
  const input: ContractInput = {
    kind,
    counterparty,
    counterpartyAddress: str(raw.counterpartyAddress, 200).replace(/\n/g, " "),
    ourRole: raw.ourRole === "CONTRACTOR" ? "CONTRACTOR" : "CLIENT",
    startDate,
    months: int(raw.months, 12, 1, 120, "契約期間(月数)"),
    autoRenew: raw.autoRenew !== false,
    purpose: str(raw.purpose, 300),
    mutual: raw.mutual !== false,
    survivalYears: int(raw.survivalYears, 3, 0, 20, "終わったあとも秘密を守る年数"),
    work: str(raw.work, 1000),
    fee: feeRaw,
    feeUnit: raw.feeUnit === "ONCE" ? "ONCE" : "MONTHLY",
    paymentDays: int(raw.paymentDays, 30, 0, 365, "支払いまでの日数"),
    freelancer: raw.freelancer === true,
    ipToClient: raw.ipToClient !== false,
    inspectionDays: int(raw.inspectionDays, 7, 0, 90, "検査の日数"),
    notes: str(raw.notes, 1000),
  };
  if (kind === "NDA" && !input.purpose) throw new UserError("秘密の情報を見せ合う目的を入れてください");
  if (kind !== "NDA" && !input.work) throw new UserError(kind === "OUTSOURCING" ? "業務の内容を入れてください" : "取引する商品を入れてください");
  if (kind === "OUTSOURCING" && input.fee === null) throw new UserError("委託料を入れてください");
  return input;
}

// 甲 = 頼む側(買う側)、乙 = 頼まれる側(売る側)。NDA は 甲 = 当社
function parties(company: string, i: ContractInput) {
  const weAreKou = i.kind === "NDA" || i.ourRole === "CLIENT";
  return { kou: weAreKou ? company : i.counterparty, otsu: weAreKou ? i.counterparty : company };
}

export function templateContract(company: { name: string; address: string | null; representative: string | null }, i: ContractInput): { title: string; preamble: string; articles: Article[] } {
  const { kou, otsu } = parties(company.name, i);
  const end = addMonthsMinusDay(i.startDate, i.months);
  const term: Article = {
    title: "有効期間",
    paragraphs: [`本契約の有効期間は、${jpDate(i.startDate)}から${jpDate(end)}までとする。`, ...(i.autoRenew ? [`期間満了の1か月前までに、甲乙いずれからも書面による申出がないときは、本契約は同一の条件でさらに${i.months}か月間更新され、以後も同様とする。`] : [])],
  };
  const common: Article[] = [
    { title: "契約の解除", paragraphs: ["甲又は乙は、相手方が本契約に違反し、相当の期間を定めて催告したにもかかわらず是正しないときは、本契約を解除することができる。", "甲又は乙は、相手方が支払停止、破産手続開始の申立てその他これに類する事由に該当したときは、催告なく直ちに本契約を解除することができる。"] },
    { title: "反社会的勢力の排除", paragraphs: ["甲及び乙は、自ら又はその役員が暴力団その他の反社会的勢力に該当しないことを表明し、保証する。相手方がこれに反したときは、催告なく本契約を解除することができる。"] },
    { title: "協議", paragraphs: ["本契約に定めのない事項又は本契約の解釈について疑義が生じたときは、甲乙誠実に協議して解決する。"] },
    { title: "合意管轄", paragraphs: ["本契約に関する紛争については、甲の本店所在地を管轄する地方裁判所を第一審の専属的合意管轄裁判所とする。"] },
  ];
  const title = DRAFT_KINDS[i.kind].title;
  if (i.kind === "NDA") {
    const preamble = `${kou}(以下「甲」という。)と${otsu}(以下「乙」という。)は、${i.purpose}(以下「本目的」という。)のために${i.mutual ? "相互に" : "甲が乙に"}開示する秘密情報の取扱いについて、次のとおり契約を締結する。`;
    return {
      title,
      preamble,
      articles: [
        { title: "秘密情報", paragraphs: [`本契約において秘密情報とは、${i.mutual ? "甲又は乙が相手方" : "甲が乙"}に対し、本目的のために開示した技術上又は営業上の情報であって、秘密である旨を明示したものをいう。`, "ただし、開示の時点で既に公知であったもの、開示後に受領者の責めによらず公知となったもの、正当な権限を有する第三者から秘密保持義務を負わずに取得したもの、及び秘密情報によらず独自に開発したものは除く。"] },
        { title: "秘密保持", paragraphs: ["秘密情報を受領した者(以下「受領者」という。)は、秘密情報を厳重に管理し、開示した者の事前の書面による承諾なく第三者に開示又は漏えいしてはならない。", "受領者は、本目的のために必要な範囲で、自らの役員及び従業員に限り秘密情報を開示することができる。この場合、受領者は、これらの者に本契約と同等の義務を負わせる。"] },
        { title: "目的外使用の禁止", paragraphs: ["受領者は、秘密情報を本目的以外に使用してはならない。"] },
        { title: "複製の制限", paragraphs: ["受領者は、本目的のために必要な範囲を超えて秘密情報を複製してはならない。"] },
        { title: "返還・廃棄", paragraphs: ["受領者は、本契約が終了したとき又は開示した者から求められたときは、秘密情報及びその複製物を速やかに返還し、又は廃棄する。"] },
        term,
        { title: "存続条項", paragraphs: [i.survivalYears > 0 ? `本契約が終了した後も、第2条から第5条までの規定は、終了の日から${i.survivalYears}年間なお効力を有する。` : "本契約が終了したときは、本契約に基づく義務も終了する。"] },
        { title: "損害賠償", paragraphs: ["甲又は乙は、本契約に違反して相手方に損害を与えたときは、その損害を賠償する。"] },
        ...common.filter((a) => a.title !== "反社会的勢力の排除"),
      ],
    };
  }
  if (i.kind === "OUTSOURCING") {
    const fee = i.fee ?? 0;
    const preamble = `${kou}(以下「甲」という。)と${otsu}(以下「乙」という。)は、甲が乙に業務を委託することについて、次のとおり契約を締結する。`;
    return {
      title,
      preamble,
      articles: [
        { title: "委託業務", paragraphs: [`甲は、次の業務(以下「本業務」という。)を乙に委託し、乙はこれを受託する。`, i.work] },
        { title: "委託料", paragraphs: [`本業務の委託料は、${i.feeUnit === "MONTHLY" ? `月額${formatYen(fee)}` : formatYen(fee)}(消費税別)とする。`] },
        { title: "支払い", paragraphs: [`甲は、${i.feeUnit === "MONTHLY" ? "毎月末日までに乙から受けた当月分の成果物又は役務の提供" : "乙から成果物の引渡し"}を受けた日から${i.paymentDays}日以内に、乙の指定する口座に振り込んで委託料を支払う。振込手数料は甲の負担とする。`] },
        { title: "検査", paragraphs: [`甲は、成果物の引渡しを受けた日から${i.inspectionDays}日以内に検査を行い、その結果を乙に通知する。期間内に通知がないときは、検査に合格したものとみなす。`] },
        { title: "再委託", paragraphs: ["乙は、甲の事前の書面による承諾なく、本業務の全部又は一部を第三者に再委託してはならない。"] },
        { title: "成果物の権利", paragraphs: [i.ipToClient ? "本業務により生じた成果物の著作権(著作権法第27条及び第28条の権利を含む。)その他の権利は、委託料の支払いが完了した時に乙から甲に移転する。乙は、甲に対して著作者人格権を行使しない。" : "本業務により生じた成果物の著作権その他の権利は乙に帰属し、甲は本業務の目的の範囲で成果物を利用することができる。"] },
        { title: "秘密保持", paragraphs: ["甲及び乙は、本業務に関して知った相手方の秘密情報を、相手方の承諾なく第三者に開示し、又は本業務以外の目的に使用してはならない。この義務は本契約の終了後も3年間存続する。"] },
        term,
        ...common,
      ],
    };
  }
  const preamble = `${kou}(以下「甲」という。)と${otsu}(以下「乙」という。)は、乙が甲に継続して商品を売り渡す取引について、次のとおり基本契約を締結する。`;
  return {
    title,
    preamble,
    articles: [
      { title: "目的・適用範囲", paragraphs: [`本契約は、乙が甲に売り渡す次の商品(以下「本商品」という。)の取引に共通して適用する。`, i.work, "個別の取引の品名・数量・価格・納期・納入場所は、甲が発行する注文書と乙の注文請書(又は乙の承諾)により定める(以下「個別契約」という。)。個別契約が本契約と異なるときは、個別契約を優先する。"] },
      { title: "納入", paragraphs: ["乙は、個別契約に定める納期に、定める場所へ本商品を納入する。納期に遅れるおそれがあるときは、直ちに甲に通知する。"] },
      { title: "検査", paragraphs: [`甲は、本商品の納入を受けた日から${i.inspectionDays}日以内に検査を行い、不合格品は乙に通知する。乙は、不合格品を速やかに引き取り、代品を納入する。`] },
      { title: "所有権と危険の移転", paragraphs: ["本商品の所有権及び危険は、検査に合格した時に乙から甲に移転する。"] },
      { title: "支払い", paragraphs: [`甲は、検査に合格した本商品の代金を、合格した日から${i.paymentDays}日以内に乙の指定する口座に振り込んで支払う。`] },
      { title: "契約不適合", paragraphs: ["検査に合格した後に本商品に種類・品質・数量に関して契約の内容に適合しないことが見つかったときは、甲は、引渡しから1年以内に通知し、修補・代替品の引渡し・代金の減額を求めることができる。"] },
      term,
      ...common,
    ],
  };
}

export function checkContract(i: ContractInput): DraftCheck[] {
  const checks: DraftCheck[] = [];
  if (i.kind === "OUTSOURCING") {
    if (i.freelancer && i.ourRole === "CLIENT") {
      if (i.paymentDays > 60) checks.push({ level: "ng", text: `支払いが受け取りから${i.paymentDays}日後です。フリーランス(従業員を使わない個人・一人社長)への委託では、受け取った日から60日以内のできるだけ早い日に支払う必要があります(フリーランス法)。` });
      checks.push({ level: "info", text: "フリーランスに委託するときは、業務の内容・報酬の額・支払期日・受け取る日と場所などを、すぐに書面かメールで示す必要があります。この契約書を渡せば、その代わりになります。" });
    }
    if (i.ipToClient) checks.push({ level: "info", text: "成果物の権利を移すときは、著作権法27条・28条の権利もはっきり書いておかないと、移っていないとみなされます(このひな形では書いています)。" });
    checks.push({ level: "info", text: "成果物を完成させて引き渡す(請負の性質がある)契約を紙で交わすときは、金額に応じた収入印紙が要ることがあります。電子契約(PDF・電子署名)なら印紙は要りません。" });
  }
  if (i.kind === "SALES") checks.push({ level: "info", text: "継続して取引する基本契約を紙で交わすときは、4,000円の収入印紙が要ることがあります(電子契約なら不要)。" });
  if (i.kind === "NDA") checks.push({ level: "info", text: "秘密保持契約には、ふつう収入印紙は要りません。" });
  if (i.months > 36 && i.autoRenew) checks.push({ level: "warn", text: "期間が長く、自動更新もあります。見直しの機会を作るため、期間を1年程度にすることも考えましょう。" });
  if (i.kind !== "NDA" && i.paymentDays > 60 && !(i.freelancer && i.ourRole === "CLIENT")) checks.push({ level: "warn", text: `支払いまで${i.paymentDays}日と長めです。相手が下請けにあたるときは、受け取った日から60日以内に払う決まりがあります(下請法)。` });
  checks.push({ level: "info", text: "これは一般的なひな形です。金額が大きい・特別な条件がある契約は、結ぶ前に弁護士などに確かめてください。" });
  return checks;
}

const SCHEMA = {
  type: "object",
  properties: {
    articles: {
      type: "array",
      items: { type: "object", properties: { title: { type: "string" }, paragraphs: { type: "array", items: { type: "string" } } }, required: ["title", "paragraphs"], additionalProperties: false },
    },
    checkpoints: { type: "array", items: { type: "string" }, description: "結ぶ前に確かめるとよい点(4つまで)" },
  },
  required: ["articles", "checkpoints"],
  additionalProperties: false,
};

const digits = (s: string) => s.match(/\d[\d,]*/g)?.map((x) => x.replace(/,/g, "")) ?? [];

export async function draftContract(user: { id: string; companyId: string }, raw: Record<string, unknown>) {
  const input = parseContractInput(raw);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true, address: true, representative: true } });
  const base = templateContract(company, input);
  const checks = checkContract(input);
  const { kou, otsu } = parties(company.name, input);
  const out = { kind: input.kind, ...base, kou, otsu, company, counterpartyAddress: input.counterpartyAddress, checks, endDate: addMonthsMinusDay(input.startDate, input.months), input };
  if (raw.useAi !== true) return { ...out, mode: "template" as const };
  const ai = await aiFor(user.companyId);
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let result: { articles: Article[]; extra: string[]; mode: "claude" | "template" } = { articles: base.articles, extra: [], mode: "template" };
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の契約書づくりを手伝う担当者です。渡したひな形(甲・乙の条文)をもとに、会社の事情(notes)に合わせて条文を直してください。",
            "ひな形の金額・日数・期間・日付・甲乙の立場は変えず、数字を増やしたり減らしたりしないでください。notes に書かれた事情を条文に反映し、相手に一方的に不利すぎる条項は作らないでください。法令の条番号など渡していない事実は増やさないでください。",
            "checkpoints には、結ぶ前に確かめるとよい点を短く書いてください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ title: base.title, kou, otsu, notes: input.notes || null, template: base.articles }) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const parsed = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { articles?: unknown; checkpoints?: unknown };
      const articles = (Array.isArray(parsed.articles) ? parsed.articles : [])
        .map((a) => a as { title?: unknown; paragraphs?: unknown })
        .filter((a) => typeof a.title === "string" && a.title.trim() && Array.isArray(a.paragraphs))
        .map((a) => ({
          title: String(a.title).replace(/^第\d+条\s*/, "").replace(/[()()]/g, "").trim().slice(0, 30),
          paragraphs: (a.paragraphs as unknown[]).filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim().slice(0, 800)).slice(0, 8),
        }))
        .filter((a) => a.paragraphs.length)
        .slice(0, 30);
      // 金額・日数などの数字がひな形と同じだけ残っているときだけ使う
      const want = new Set(digits(base.articles.flatMap((a) => a.paragraphs).join(" ")));
      const got = new Set(digits(articles.flatMap((a) => a.paragraphs).join(" ")));
      const keptNumbers = [...want].every((n) => got.has(n));
      const extra = (Array.isArray(parsed.checkpoints) ? parsed.checkpoints : []).filter((c): c is string => typeof c === "string" && !!c.trim()).map((c) => c.trim().slice(0, 200)).slice(0, 4);
      if (articles.length >= Math.max(5, base.articles.length - 3) && keptNumbers) result = { articles, extra, mode: "claude" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `${base.title}の下書き`, tools: [], mode: `contract-draft-${result.mode}` } });
  return { ...out, articles: result.articles, checks: [...checks, ...result.extra.map((t) => ({ level: "info" as const, text: t }))], mode: result.mode };
}

// できた契約書を「契約書の台帳」に登録する(期限の管理のため)
export async function registerDraftToLedger(user: { name: string; companyId: string }, raw: Record<string, unknown>) {
  const input = parseContractInput(raw);
  const contract = await prisma.contract.create({
    data: {
      companyId: user.companyId,
      title: `${DRAFT_KINDS[input.kind].title}(${input.counterparty})`,
      counterparty: input.counterparty,
      kind: input.kind,
      startDate: new Date(`${input.startDate}T00:00:00+09:00`),
      endDate: new Date(`${addMonthsMinusDay(input.startDate, input.months)}T00:00:00+09:00`),
      autoRenew: input.autoRenew,
      renewalMonths: input.autoRenew ? input.months : null,
      noticeDays: input.autoRenew ? 30 : null,
      amount: input.kind === "OUTSOURCING" ? input.fee : null,
      amountPeriod: input.kind === "OUTSOURCING" ? (input.feeUnit === "MONTHLY" ? "MONTHLY" : "ONCE") : null,
      paymentTerms: input.kind === "NDA" ? null : `受け取りから${input.paymentDays}日以内`,
      summary: "契約書のひな形から登録しました(締結前の下書き)。",
      mode: "draft",
      createdBy: user.name.slice(0, 60),
    },
  });
  await audit("契約書を台帳に登録", contract.title);
  return { id: contract.id };
}
