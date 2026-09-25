"use client";

// 画面をそのまま印刷(PDF保存)する。メニューやボタン類は印刷されない。
export function PrintButton({ variant = "primary", label }: { variant?: "primary" | "outline"; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={
        variant === "primary"
          ? "rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 print:hidden"
          : "shrink-0 self-start rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50 print:hidden"
      }
    >
      {label ?? (variant === "primary" ? "印刷・PDF保存" : "印刷・PDF")}
    </button>
  );
}
