import type { CSSProperties } from "react";

// Clerkly のロゴ。頭文字の C をゼムクリップの形にしたマーク(朱色)と「lerkly」(紺)で「Clerkly」と読ませる。
// ・文字: Outfit 500、字間 -0.02em
// ・マーク: 高さは文字サイズの 0.75 倍、幅:高さ = 77:84。文字とベースラインでそろえ、2〜3% 下にはみ出させる
// ・マークと文字の間は文字サイズの約 0.035 倍
// ・濃い背景では文字を #EDEFF2 に(マークは朱色のまま)

export const BRAND = { name: "Clerkly", kana: "クラークリー", navy: "#1B2A4A", vermilion: "#E0522D", paper: "#EDEFF2", surface: "#DADFE6", light: "#F7F8FA" } as const;

export const MARK_PATH = "M80.64 24.29 A40 40 0 1 0 80.64 75.71 A5.5 5.5 0 0 0 72.22 68.64 A29 29 0 1 1 57.51 21.99";
export const MARK_VIEWBOX = "5 5 82 90";

export function ClerklyMark({ className, style, color = BRAND.vermilion, title }: { className?: string; style?: CSSProperties; color?: string; title?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} style={{ color, ...style }} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d={MARK_PATH} fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" />
    </svg>
  );
}

// size: 文字サイズ(px)。dark: 濃い背景(#1B2A4A)の上に置くとき
export function ClerklyLogo({ size = 20, dark = false, className }: { size?: number; dark?: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label={BRAND.name}
      className={className}
      style={{
        display: "inline-block",
        whiteSpace: "nowrap",
        fontFamily: "var(--font-outfit), sans-serif",
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        color: dark ? BRAND.paper : BRAND.navy,
      }}
    >
      <ClerklyMark style={{ display: "inline-block", height: "0.75em", width: `${(0.75 * 77) / 84}em`, marginRight: "0.035em", verticalAlign: "-0.025em" }} />
      <span aria-hidden>lerkly</span>
    </span>
  );
}
