import { SparkleIcon } from "@/components/icons";

const POINTS = [
  { title: "書類は入れるだけ", text: "レシート・請求書・契約書をAIが見分けて記帳まで" },
  { title: "毎朝AIがまとめる", text: "今日やること・資金・入金の遅れを優先順に" },
  { title: "聞けば答える", text: "「今月の利益は?」にAIが帳簿を調べて回答" },
  { title: "確定は人が押したときだけ", text: "AIは下書きを作り、あなたが確かめて実行" },
];

// ログイン画面の外枠: パソコンでは左にサービスの紹介、右にフォーム
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 lg:min-h-[calc(100vh-3rem)] lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden rounded-3xl bg-linear-to-br from-indigo-600 via-indigo-700 to-violet-800 p-10 text-white shadow-lg lg:block">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-violet-400/20 blur-3xl" aria-hidden />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-white/25">
            <SparkleIcon className="h-3.5 w-3.5" />
            AIが最初から組み込まれた経理・事務
          </span>
          <h2 className="mt-5 text-[28px] leading-snug font-bold">
            面倒な事務は、
            <br />
            AIにまかせる。
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-indigo-100">経費精算・請求書・給与・決算まで。小さな会社のバックオフィスを、ひとつの画面で。</p>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                  <SparkleIcon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{p.title}</span>
                  <span className="block text-xs text-indigo-100">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <div className="flex justify-center">{children}</div>
    </div>
  );
}
