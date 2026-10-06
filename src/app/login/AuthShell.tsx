import { CheckIcon } from "@/components/icons";
import { ClerklyLogo } from "@/components/Logo";

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
      <section className="relative hidden overflow-hidden rounded-3xl bg-slate-900 p-10 text-slate-50 lg:block">
        <div className="relative">
          <div>
            <ClerklyLogo size={34} dark />
          </div>
          <p className="mt-6 inline-block rounded-full px-3 py-1 text-xs font-medium text-slate-300 ring-1 ring-white/20">AIが最初から組み込まれた経理・事務</p>
          <h2 className="mt-5 text-[28px] leading-snug font-bold">
            面倒な事務は、
            <br />
            AIにまかせる。
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">経費精算・請求書・給与・決算まで。小さな会社のバックオフィスを、ひとつの画面で。</p>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/25">
                  <CheckIcon className="h-4 w-4 text-vermilion-400" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{p.title}</span>
                  <span className="block text-xs text-slate-300">{p.text}</span>
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
