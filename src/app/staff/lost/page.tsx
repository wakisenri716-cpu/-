import { LostView } from "./LostView";

// 従業員: 落とし物・忘れ物
export default async function StaffLostPage({ searchParams }: { searchParams: Promise<{ text?: string; q?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">落とし物・忘れ物</h1>
        <p className="mt-1 text-sm text-slate-600">なくしたものを探したり、見つけたものを届けたりできます。</p>
      </div>
      <LostView initialText={String(sp.text ?? "").slice(0, 200)} initialQuery={String(sp.q ?? "").slice(0, 100)} />
    </div>
  );
}
