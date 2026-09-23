import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "crypto";

// Node標準の scrypt でハッシュ化する(外部ライブラリ不要)。保存形式: scrypt$N$r$p$salt$hash
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 8;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// 存在しないメールアドレスでも同じだけ時間をかけ、応答時間から登録の有無を推測されないようにする
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));
export async function burnPasswordCheck(password: string) {
  await verifyPassword(password, await DUMMY_HASH);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`;
  if (password.length > 200) return "パスワードが長すぎます";
  return null;
}
