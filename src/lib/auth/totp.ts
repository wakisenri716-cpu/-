import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

// 認証アプリ(Google Authenticator など)の6桁コード。RFC 6238(30秒ごと・HMAC-SHA1・6桁)。
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret() {
  return base32Encode(randomBytes(20));
}

export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function totpAt(secret: string, step: number, digits = DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

// 時計のずれを考えて前後30秒も受け付ける。前回使ったコード(lastStep 以前)は受け付けない。
// 一致したら、その区切りの番号を返す(次回の lastStep として保存する)。
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()) {
  const normalized = code.normalize("NFKC").replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, s));
    if (timingSafeEqual(expected, Buffer.from(normalized))) return s;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = "経理オートメーション") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// 回復コード: スマホをなくしたときに1回だけ使えるコード。ハッシュだけを保存する。
function hashCode(code: string) {
  return createHash("sha256").update(code.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
}

export function generateRecoveryCodes(count = 8) {
  const codes = Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(5)).toLowerCase().slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
  return { codes, stored: JSON.stringify(codes.map(hashCode)) };
}

// 一致した回復コードを消した残りを返す(一致しなければ null)
export function consumeRecoveryCode(stored: string | null, code: string) {
  if (!stored) return null;
  const hashes: string[] = JSON.parse(stored);
  const target = hashCode(code.normalize("NFKC"));
  const index = hashes.findIndex((h) => timingSafeEqual(Buffer.from(h), Buffer.from(target)));
  if (index < 0) return null;
  hashes.splice(index, 1);
  return JSON.stringify(hashes);
}
