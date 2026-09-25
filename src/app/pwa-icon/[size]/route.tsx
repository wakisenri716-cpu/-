import { ImageResponse } from "next/og";

const SIZES = new Set([180, 192, 512]);

// アプリのアイコン(サイドバーの「AI」ロゴと同じデザイン)。maskable でも切れないよう余白を広めに取る。
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#4f46e5" }}>
        <div style={{ color: "white", fontSize: size * 0.36, fontWeight: 700, letterSpacing: size * -0.01 }}>AI</div>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
