import { ImageResponse } from "next/og";
import { BRAND, MARK_PATH } from "@/components/Logo";

const SIZES = new Set([180, 192, 512]);

// アプリのアイコン: 朱色の角丸正方形(角丸は一辺の約23%)の中央に、クリップの C のマーク(#F7F8FA、高さは一辺の約56%)。
// ?bleed=1 は角丸なしの正方形(iPhone のホーム画面・Android の maskable は OS が角を丸めるので)
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const bleed = new URL(request.url).searchParams.get("bleed") === "1";
  const markHeight = size * 0.56;
  const markWidth = (markHeight * 82) / 90;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.vermilion, borderRadius: bleed ? 0 : size * 0.23 }}>
        <svg width={markWidth} height={markHeight} viewBox="5 5 82 90">
          <path d={MARK_PATH} fill="none" stroke={BRAND.light} strokeWidth={6} strokeLinecap="round" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
