const BRAND = Symbol.for("keiri.userError");

// 利用者にそのまま見せてよいエラー(入力ミス・状態の不一致など)。API はこれを 400 として返す。
// 開発サーバーではルートごとにこのモジュールが別々に読み込まれることがあり、クラスの同一性で判定すると
// 別の読み込みで作られたエラーを見落とすので、instanceof はクラスではなく目印(Symbol.for)で判定する。
export class UserError extends Error {
  readonly [BRAND] = true;

  static [Symbol.hasInstance](value: unknown) {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
  }
}

// 締めた期間の仕訳を追加・変更しようとした(データベースのトリガーが止めたもの)
export class BooksClosedError extends UserError {}

const BOOKS_CLOSED = /BOOKS_CLOSED:(\d{4}-\d{2}-\d{2})/;

export function toBooksClosedError(error: unknown) {
  const match = error instanceof Error ? error.message.match(BOOKS_CLOSED) : null;
  if (!match) return null;
  const [y, m, d] = match[1].split("-").map(Number);
  return new BooksClosedError(`${y}年${m}月${d}日までの帳簿は締めてあるため、その期間の仕訳は追加・変更・取消できません(「締め処理」で締めを解除できます)`);
}
