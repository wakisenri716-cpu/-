import { headers } from "next/headers";
import { forbidden } from "next/navigation";

// 税理士・会計事務所(ADVISOR)は閲覧だけ。データを変える送信(GET 以外)は、自分のアカウントの操作・会社の切り替え・
// AIアシスタントへの質問・シミュレーション・予算の差の原因・着地見込みの見立て・経営分析の解説・税金と労務の段取り・交際費の見立て・仕訳の説明・仕訳へのコメントだけを通し、ほかは 403 にする。
// proxy が実際のメソッドとパスを x-method / x-pathname に入れて渡す(外から送られた同じ名前のヘッダーは上書きされる)。
const SAFE = ["GET", "HEAD", "OPTIONS"];
const ALLOWED = [
  /^\/api\/auth\//,
  /^\/api\/account(\/|$)/,
  /^\/api\/welcome$/,
  /^\/api\/companies\/switch$/,
  /^\/api\/assistant$/,
  /^\/api\/simulation$/,
  /^\/api\/budgets\/variance$/,
  /^\/api\/tax-forecast$/,
  /^\/api\/analysis\/explain$/,
  /^\/api\/tax-calendar\/plan$/,
  /^\/api\/entertainment\/advice$/,
  /^\/api\/journal\/[^/]+\/explain$/,
  /^\/api\/journal\/[^/]+\/comments$/,
  /^\/api\/support$/,
];

export function advisorMayWrite(path: string) {
  return ALLOWED.some((re) => re.test(path));
}

export async function guardAdvisor() {
  const h = await headers();
  const method = (h.get("x-method") ?? "GET").toUpperCase();
  if (SAFE.includes(method)) return;
  if (advisorMayWrite(h.get("x-pathname") ?? "")) return;
  forbidden();
}
