import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";

// 安全の設定(会社ごと): 2段階認証の必須化・自動ログアウト・IPアドレス制限・新しい端末のログイン通知。

export const IDLE_OPTIONS = [
  { minutes: null, label: "しない(30日)" },
  { minutes: 15, label: "15分" },
  { minutes: 30, label: "30分" },
  { minutes: 60, label: "1時間" },
  { minutes: 120, label: "2時間" },
  { minutes: 480, label: "8時間" },
  { minutes: 1440, label: "1日" },
] as const;

// ---- IP アドレス ----

// アクセス元の IP。Vercel などでは x-forwarded-for の先頭が本当のアクセス元
export function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "";
  return ip ? normalizeIp(ip) : null;
}

function normalizeIp(ip: string) {
  const v = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : v;
}

// IP を数値にする(IPv4 は 32 ビット、IPv6 は 128 ビット)
function toBits(ip: string): { bits: bigint; size: 32 | 128 } | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { bits: parts.reduce((acc, p) => (acc << BigInt(8)) | BigInt(p), BigInt(0)), size: 32 };
  }
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(":")) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { bits: groups.reduce((acc, g) => (acc << BigInt(16)) | BigInt(parseInt(g, 16)), BigInt(0)), size: 128 };
}

export type IpRule = { text: string; bits: bigint; size: 32 | 128; prefix: number };

export function parseIpRule(line: string): IpRule | null {
  const text = line.normalize("NFKC").trim();
  const [addr, prefixText] = text.split("/");
  const parsed = toBits(normalizeIp(addr ?? ""));
  if (!parsed) return null;
  const prefix = prefixText === undefined ? parsed.size : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsed.size) return null;
  return { text, ...parsed, prefix };
}

export function parseIpList(text: string | null | undefined) {
  return (text ?? "")
    .split(/[\r\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseIpRule)
    .filter((r): r is IpRule => r !== null);
}

export function ipAllowed(ip: string | null, allowedIps: string | null | undefined) {
  const rules = parseIpList(allowedIps);
  if (rules.length === 0) return true;
  const target = ip ? toBits(ip) : null;
  if (!target) return false;
  return rules.some((r) => {
    if (r.size !== target.size) return false;
    const shift = BigInt(r.size - r.prefix);
    return r.bits >> shift === target.bits >> shift;
  });
}

// ---- 端末 ----

// 同じブラウザかどうかを見分けるための印(User-Agent のハッシュの先頭)
export function deviceId(userAgent: string | null) {
  return createHash("sha256").update(userAgent ?? "").digest("hex").slice(0, 10);
}

export function deviceLabel(userAgent: string | null) {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "ブラウザ";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "不明な端末";
  return `${browser} / ${os}`;
}

// ---- 設定 ----

export async function getSecuritySettings(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { require2fa: true, sessionIdleMinutes: true, allowedIps: true, loginAlert: true },
  });
  return c;
}

export async function updateSecuritySettings(
  companyId: string,
  input: { require2fa?: unknown; sessionIdleMinutes?: unknown; allowedIps?: unknown; loginAlert?: unknown },
  currentIp: string | null,
) {
  const data: { require2fa?: boolean; sessionIdleMinutes?: number | null; allowedIps?: string | null; loginAlert?: boolean } = {};
  if (typeof input.require2fa === "boolean") data.require2fa = input.require2fa;
  if (typeof input.loginAlert === "boolean") data.loginAlert = input.loginAlert;
  if (input.sessionIdleMinutes !== undefined) {
    const value = input.sessionIdleMinutes === null || input.sessionIdleMinutes === "" ? null : Number(input.sessionIdleMinutes);
    if (!IDLE_OPTIONS.some((o) => o.minutes === value)) throw new UserError("自動ログアウトの時間を選んでください");
    data.sessionIdleMinutes = value;
  }
  if (input.allowedIps !== undefined) {
    const lines = String(input.allowedIps ?? "")
      .split(/[\r\n,]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 50) throw new UserError("IPアドレスは50件までです");
    const bad = lines.filter((l) => !parseIpRule(l));
    if (bad.length) throw new UserError(`IPアドレスの書き方が正しくありません: ${bad.slice(0, 3).join("、")}(例: 203.0.113.5 や 203.0.113.0/24)`);
    const text = lines.join("\n") || null;
    // 自分が締め出されないよう、今つないでいる場所が入っていないと保存しない
    if (text && !ipAllowed(currentIp, text)) {
      throw new UserError(`今お使いの場所(${currentIp ?? "不明"})が入っていません。このまま保存すると、あなたもこの会社を開けなくなります`);
    }
    data.allowedIps = text;
  }
  await prisma.company.update({ where: { id: companyId }, data });
  return getSecuritySettings(companyId);
}

// ---- 安全の点検 ----

export async function securityReport(companyId: string) {
  const [members, settings] = await Promise.all([
    prisma.companyMember.findMany({
      where: { companyId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            totpEnabled: true,
            passwordHash: true,
            failedLogins: true,
            lockedUntil: true,
            sessions: { select: { lastSeenAt: true, createdAt: true, companyId: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
          },
        },
      },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    }),
    getSecuritySettings(companyId),
  ]);
  const now = Date.now();
  const rows = members.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    active: m.active,
    totp: m.user.totpEnabled,
    hasPassword: m.user.passwordHash !== null,
    lastSeen: m.user.sessions[0]?.lastSeenAt ?? m.user.sessions[0]?.createdAt ?? null,
    locked: !!m.user.lockedUntil && m.user.lockedUntil.getTime() > now,
    failedLogins: m.user.failedLogins,
  }));
  const active = rows.filter((r) => r.active && r.hasPassword);
  const admins = active.filter((r) => r.role === "ADMIN");
  const checks = [
    { ok: admins.every((a) => a.totp), label: "管理者の2段階認証", detail: admins.every((a) => a.totp) ? "すべての管理者が設定済みです" : `${admins.filter((a) => !a.totp).map((a) => a.name).join("・")}さんが未設定です` },
    {
      ok: settings.require2fa || active.every((r) => r.totp),
      label: "メンバーの2段階認証",
      detail: `${active.filter((r) => r.totp).length} / ${active.length}人が設定済み${settings.require2fa ? "(必須にしています)" : ""}`,
    },
    { ok: admins.length >= 2, label: "管理者の人数", detail: admins.length >= 2 ? `${admins.length}人` : "1人だけです。ログインできなくなったときのために、もう1人いると安心です" },
    { ok: settings.sessionIdleMinutes !== null, label: "自動ログアウト", detail: settings.sessionIdleMinutes ? `${IDLE_OPTIONS.find((o) => o.minutes === settings.sessionIdleMinutes)?.label}操作しないとログアウトします` : "設定していません(共用のパソコンで使うなら設定をおすすめします)" },
    {
      ok: !rows.some((r) => r.locked || r.failedLogins >= 3),
      label: "ログインの失敗",
      detail: rows.some((r) => r.locked || r.failedLogins >= 3) ? `${rows.filter((r) => r.locked || r.failedLogins >= 3).map((r) => r.name).join("・")}さんのログインの失敗が続いています` : "続けて失敗している人はいません",
    },
    {
      ok: !active.some((r) => r.lastSeen && now - r.lastSeen.getTime() > 90 * 86_400_000),
      label: "しばらく使っていない人",
      detail: active.some((r) => r.lastSeen && now - r.lastSeen.getTime() > 90 * 86_400_000)
        ? `${active.filter((r) => r.lastSeen && now - r.lastSeen.getTime() > 90 * 86_400_000).map((r) => r.name).join("・")}さんが90日以上使っていません。辞めた人なら利用停止にしてください`
        : "ありません",
    },
  ];
  return { settings, rows, checks };
}
