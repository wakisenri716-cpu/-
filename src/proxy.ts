import { NextResponse, type NextRequest } from "next/server";

// ここではクッキーの有無と形だけを見る(楽観的チェック)。セッションが本当に有効かは、
// データを読み書きする直前の requireUser()/requireCompanyId() でデータベースと照合する。
const SESSION_COOKIE = "session";
// ホーム画面に追加するためのマニフェストとアイコンも、ログイン前に読めるようにする
// メールで送った書類の共有リンク(/share)とパスワード再設定、毎朝のお知らせ(CRON_SECRET で守る)もログインなしで使う
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/setup",
  "/api/seed",
  "/manifest.webmanifest",
  "/pwa-icon",
  "/share",
  "/forgot-password",
  "/reset-password",
  "/api/auth/forgot",
  "/api/auth/reset",
  "/api/cron",
];

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

// ほかのサイトから送られてきた書き込み(CSRF)を断る。ブラウザは送信元を Origin / Sec-Fetch-Site で知らせる
function crossSite(request: NextRequest) {
  if (SAFE_METHODS.includes(request.method)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  return request.headers.get("sec-fetch-site") === "cross-site";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api") && !pathname.startsWith("/api/cron") && crossSite(request)) {
    return NextResponse.json({ error: "ほかのサイトからの送信は受け付けていません" }, { status: 403 });
  }
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
    // レイアウトで役割ごとに見られる画面を判定できるよう、表示中のパスを渡す
    const headers = new Headers(request.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
