import type { MetadataRoute } from "next";

// スマホ・タブレットの「ホーム画面に追加」でアプリのように開けるようにする(タイムカード用の共用端末など)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clerkly",
    short_name: "Clerkly",
    description: "経費・請求書・銀行明細の仕訳から給与・決算まで、小さな会社の事務をまとめるサービス",
    start_url: "/",
    display: "standalone",
    background_color: "#EDEFF2",
    theme_color: "#1B2A4A",
    lang: "ja",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512?bleed=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "タイムカード", url: "/timeclock" },
      { name: "経費精算", url: "/expenses" },
    ],
  };
}
