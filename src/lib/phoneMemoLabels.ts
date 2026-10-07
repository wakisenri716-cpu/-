// 伝言メモの種類と「どうしてほしいか」(画面とサーバーの両方で使う)
export const MEMO_KINDS = { CALL: "電話", VISIT: "来客" } as const;
export const MEMO_ACTIONS = { CALLBACK: "折り返しお願いします", WILL_CALL: "また電話します", FYI: "伝言のみ" } as const;
export type MemoKind = keyof typeof MEMO_KINDS;
export type MemoAction = keyof typeof MEMO_ACTIONS;
