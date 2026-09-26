import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { jstDateKey } from "@/lib/jst";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

function jp(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | undefined, max = 40) => (v ?? "").replace(/[\r\n]/g, " ").trim().slice(0, max);

// 電子取引データの訂正及び削除の防止に関する事務処理規程(国税庁が公表している法人向けの例をもとにしたひな形)
export default async function RulesPage({ searchParams }: { searchParams: Promise<{ manager?: string; handler?: string; start?: string }> }) {
  const companyId = await requireCompanyId();
  const q = await searchParams;
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
  const manager = clean(q.manager) || "経理部長";
  const handler = clean(q.handler) || "経理担当者";
  const start = q.start && DATE.test(q.start) ? q.start : jstDateKey(new Date());
  const article = "space-y-1";

  return (
    <div className="space-y-4">
      <div className="space-y-3 print:hidden">
        <Link href="/compliance" className="text-sm text-indigo-700 hover:underline">
          ← 電子帳簿保存法の対応
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">事務処理規程のひな形</h1>
            <p className="mt-1 text-sm text-slate-600">
              国税庁が公表している規程の例(法人向け)をもとにしています。管理責任者などを入れて「反映」を押し、印刷して社内に備え付けてください(押印・署名は印刷後に)。
            </p>
          </div>
          <PrintButton />
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="text-xs text-slate-500">
            管理責任者(役職・氏名)
            <input name="manager" defaultValue={manager} maxLength={40} className="mt-1 block w-56 rounded-md border px-2 py-1.5 text-sm text-slate-900" />
          </label>
          <label className="text-xs text-slate-500">
            処理責任者(役職・氏名)
            <input name="handler" defaultValue={handler} maxLength={40} className="mt-1 block w-56 rounded-md border px-2 py-1.5 text-sm text-slate-900" />
          </label>
          <label className="text-xs text-slate-500">
            施行日
            <input type="date" name="start" defaultValue={start} className="mt-1 block rounded-md border px-2 py-1.5 text-sm text-slate-900" />
          </label>
          <button type="submit" className="rounded-md border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            反映
          </button>
        </form>
      </div>

      <article className="mx-auto max-w-[210mm] space-y-5 bg-white p-6 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <h2 className="text-center text-lg font-bold">電子取引データの訂正及び削除の防止に関する事務処理規程</h2>
        <p className="text-right">{company.name}</p>

        <section className={article}>
          <h3 className="font-semibold">第1条(目的)</h3>
          <p>
            この規程は、電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律第7条に定められた電子取引の取引情報に係る電磁的記録の保存義務を適正に履行するために必要な事項を定め、これに基づき保存している電磁的記録の真実性を確保することを目的とする。
          </p>
        </section>
        <section className={article}>
          <h3 className="font-semibold">第2条(適用範囲)</h3>
          <p>この規程は、{company.name}(以下「当社」という。)の全ての役員及び従業員に対して適用する。</p>
        </section>
        <section className={article}>
          <h3 className="font-semibold">第3条(管理責任者)</h3>
          <p>
            この規程の管理責任者は{manager}とし、処理責任者は{handler}とする。
          </p>
        </section>
        <section className={article}>
          <h3 className="font-semibold">第4条(電子取引の範囲)</h3>
          <p>当社における電子取引の範囲は、以下に掲げる取引とする。</p>
          <ol className="list-decimal pl-6">
            <li>電子メール(添付ファイルを含む)により請求書・領収書等を授受する取引</li>
            <li>ウェブサイト・クラウドサービス上で請求書・領収書等を授受する取引</li>
            <li>インターネットバンキング・キャッシュレス決済の利用明細等を授受する取引</li>
          </ol>
        </section>
        <section className={article}>
          <h3 className="font-semibold">第5条(取引データの保存)</h3>
          <p>
            取引先から受領した取引関係情報及び取引相手に提供した取引関係情報のうち、前条に定める取引に係るデータは、経理システム(以下「本システム」という。)に速やかに保存し、取引日・取引金額・取引先で検索できる状態で保存する。
          </p>
          <p>2 本システムは、保存したデータの登録・訂正・削除の履歴を自動で記録し、その履歴を訂正・削除できない状態で保存する。</p>
          <p>3 データの保存期間は、法人税法に定める期間(原則7年間。欠損金の繰越控除を受ける事業年度に係るものは10年間)とする。</p>
        </section>
        <section className={article}>
          <h3 className="font-semibold">第6条(訂正削除の原則禁止)</h3>
          <p>本システムに保存する取引関係情報は、原則として訂正又は削除を行ってはならない。</p>
        </section>
        <section className={article}>
          <h3 className="font-semibold">第7条(訂正削除を行う場合)</h3>
          <p>
            業務処理上やむを得ない理由によって保存する取引関係情報を訂正又は削除する必要が生じた場合は、「取引情報訂正・削除申請書」に以下の内容を記載の上、管理責任者へ提出すること。
          </p>
          <ol className="list-decimal pl-6">
            <li>申請日</li>
            <li>取引伝票番号(請求書番号等)</li>
            <li>取引件名</li>
            <li>取引先名</li>
            <li>訂正・削除日付</li>
            <li>訂正・削除内容</li>
            <li>訂正・削除理由</li>
            <li>処理担当者名</li>
          </ol>
          <p>2 管理責任者は、前項の申請を承認した場合、処理責任者に訂正・削除の処理を行わせ、処理後にその内容を確認するものとする。</p>
          <p>3 取引情報訂正・削除申請書は、当該申請に係る取引データの保存期間が満了するまで保存する。</p>
        </section>
        <section className={article}>
          <h3 className="font-semibold">附則</h3>
          <p>(施行)この規程は、{jp(start)}から施行する。</p>
        </section>

        <section className="break-before-page space-y-3 pt-6">
          <h2 className="text-center text-base font-bold">取引情報訂正・削除申請書</h2>
          <p className="text-right text-xs">申請日: 　　年　　月　　日</p>
          <table className="w-full border-collapse text-xs">
            <tbody>
              {["取引伝票番号(請求書番号等)", "取引件名", "取引先名", "訂正・削除日付", "訂正・削除内容", "訂正・削除理由", "処理担当者名"].map((label) => (
                <tr key={label}>
                  <th className="w-44 border border-slate-400 bg-slate-50 px-2 py-3 text-left font-medium print:bg-slate-100">{label}</th>
                  <td className="border border-slate-400 px-2 py-3" />
                </tr>
              ))}
            </tbody>
          </table>
          <table className="ml-auto border-collapse text-center text-xs">
            <tbody>
              <tr>
                {["申請者", "処理責任者", "管理責任者"].map((h) => (
                  <th key={h} className="w-20 border border-slate-400 px-2 py-1 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
              <tr>
                {[0, 1, 2].map((i) => (
                  <td key={i} className="h-14 border border-slate-400" />
                ))}
              </tr>
            </tbody>
          </table>
        </section>
      </article>
      <p className="text-xs text-slate-500 print:hidden">※ ひな形です。会社の実態に合わせて内容を見直し、必要に応じて税理士に確認してください。</p>
    </div>
  );
}
