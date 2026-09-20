const STYLES: Record<string, string> = {
  AUTO_POSTED: "bg-emerald-100 text-emerald-800",
  AUTO_APPROVED: "bg-emerald-100 text-emerald-800",
  AUTO_APPLIED: "bg-emerald-100 text-emerald-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  POSTED_MANUALLY: "bg-blue-100 text-blue-800",
  APPROVED: "bg-blue-100 text-blue-800",
  CORRECTED: "bg-blue-100 text-blue-800",
  PENDING_REVIEW: "bg-amber-100 text-amber-800",
  NEEDS_REVIEW: "bg-amber-100 text-amber-800",
  DRAFT: "bg-slate-100 text-slate-700",
  SUBMITTED: "bg-slate-100 text-slate-700",
  REJECTED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-rose-100 text-rose-800",
  VOID: "bg-rose-100 text-rose-800",
};

const LABELS: Record<string, string> = {
  AUTO_POSTED: "AI自動処理済み",
  AUTO_APPROVED: "AI自動承認",
  AUTO_APPLIED: "AI自動適用",
  CONFIRMED: "確定",
  POSTED_MANUALLY: "人による承認済み",
  APPROVED: "承認済み",
  CORRECTED: "人が修正して適用",
  PENDING_REVIEW: "レビュー待ち",
  NEEDS_REVIEW: "レビュー待ち",
  DRAFT: "下書き",
  SUBMITTED: "提出済み",
  REJECTED: "却下",
  CANCELLED: "取消",
  VOID: "無効",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-slate-100 text-slate-700"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
