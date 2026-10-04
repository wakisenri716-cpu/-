import { createSign, sign } from "node:crypto";

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

// Apple(APNs)用: ES256 で署名した JWT
export function es256Jwt(header: object, payload: object, privateKeyPem: string) {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(data), { key: privateKeyPem, dsaEncoding: "ieee-p1363" });
  return `${data}.${b64url(signature)}`;
}

// Google(FCM のアクセストークン)用: RS256 で署名した JWT
export function rs256Jwt(header: object, payload: object, privateKeyPem: string) {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  return `${data}.${b64url(signer.sign(privateKeyPem))}`;
}
