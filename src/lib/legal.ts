// 利用規約・プライバシーポリシーの版と、運営者の表示。
// 運営者名・連絡先は環境変数で設定する(未設定のときは、設定を促す仮の表示)。
// 規約の中身を変えたら TERMS_VERSION を上げる。次のログインで、全員にもう一度同意してもらう。
export const TERMS_VERSION = "2026-09-28";
export const TERMS_EFFECTIVE = "2026年9月28日";

export function operator() {
  return {
    name: process.env.SERVICE_OPERATOR_NAME || "本サービスの運営者",
    contact: process.env.SERVICE_CONTACT_EMAIL || null,
    address: process.env.SERVICE_OPERATOR_ADDRESS || null,
    configured: !!process.env.SERVICE_OPERATOR_NAME,
  };
}
