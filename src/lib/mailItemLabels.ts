// 郵便物・荷物の種類(画面とサーバーの両方で使う)
export const MAIL_KINDS = {
  LETTER: "郵便物",
  INVOICE: "請求書",
  PACKAGE: "荷物",
  REGISTERED: "書留など",
  OFFICIAL: "役所から",
  DM: "DM・案内",
} as const;
export type MailKind = keyof typeof MAIL_KINDS;
export const isMailKind = (v: unknown): v is MailKind => typeof v === "string" && Object.hasOwn(MAIL_KINDS, v);
// 早めに渡したいもの
export const IMPORTANT_KINDS: MailKind[] = ["REGISTERED", "OFFICIAL", "INVOICE"];
