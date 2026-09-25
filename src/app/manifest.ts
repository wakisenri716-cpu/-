import type { MetadataRoute } from "next";

// スマホ・タブレットの「ホーム画面に追加」でアプリのように開けるようにする(タイムカード用の共用端末など)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "経理オートメーション",
    short_name: "経理AI",
    description: "AIが経費・請求書・銀行明細を仕訳する経理アプリ",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#4f46e5",
    lang: "ja",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "タイムカード", url: "/timeclock" },
      { name: "経費精算", url: "/expenses" },
    ],
  };
}
