import { jstDateKey } from "@/lib/jst";
import type { NormalizedPosSale } from "./types";

// スマレジ・プラットフォームAPI (https://developers.smaregi.dev/platform-api-reference/)
// client_credentials でアクセストークンを取得し、POS 取引一覧を取得する。

type SmaregiConfig = {
  contractId: string;
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
};

export const MAX_SYNC_DAYS = 31;
const PAGE_LIMIT = 1000;

export function getSmaregiConfig(): SmaregiConfig | null {
  const contractId = process.env.SMAREGI_CONTRACT_ID;
  const clientId = process.env.SMAREGI_CLIENT_ID;
  const clientSecret = process.env.SMAREGI_CLIENT_SECRET;
  if (!contractId || !clientId || !clientSecret) return null;
  return { contractId, clientId, clientSecret, sandbox: process.env.SMAREGI_SANDBOX === "true" };
}

function hosts(config: SmaregiConfig) {
  const domain = config.sandbox ? "smaregi.dev" : "smaregi.jp";
  return { idHost: `https://id.${domain}`, apiHost: `https://api.${domain}` };
}

async function fetchAccessToken(config: SmaregiConfig): Promise<string> {
  const { idHost } = hosts(config);
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(`${idHost}/app/${encodeURIComponent(config.contractId)}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "pos.transactions:read" }),
  });
  if (!res.ok) {
    throw new Error(`スマレジのアクセストークン取得に失敗しました (HTTP ${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("スマレジのトークン応答に access_token がありません");
  return body.access_token;
}

type SmaregiTransaction = {
  transactionHeadId: string;
  transactionDateTime: string;
  transactionHeadDivision?: string;
  cancelDivision?: string;
  storeId?: string;
  total?: string;
  taxInclude?: string;
  taxExclude?: string;
  depositCash?: string;
  change?: string;
};

function toInt(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function normalizeSmaregiTransaction(t: SmaregiTransaction): NormalizedPosSale | null {
  // 1 = 通常取引。入出金・両替などの取引区分や取消済み取引は売上ではないので除外する。
  if (t.transactionHeadDivision && t.transactionHeadDivision !== "1") return null;
  if (t.cancelDivision && t.cancelDivision !== "0") return null;

  const total = toInt(t.total);
  const tax = toInt(t.taxInclude) + toInt(t.taxExclude);
  // depositCash は預かり金額なので、お釣りを引いた分が実際の現金売上。
  const cash = total >= 0 ? Math.min(Math.max(toInt(t.depositCash) - toInt(t.change), 0), total) : total;

  return {
    externalId: t.transactionHeadId,
    soldAt: new Date(t.transactionDateTime),
    storeName: t.storeId ? `店舗ID ${t.storeId}` : null,
    totalAmount: total,
    taxAmount: tax,
    cashAmount: cash,
    cashlessAmount: total - cash,
  };
}

function isoJst(date: string, endOfDay: boolean): string {
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}+09:00`;
}

async function fetchTransactions(config: SmaregiConfig, from: string, to: string): Promise<SmaregiTransaction[]> {
  const token = await fetchAccessToken(config);
  const { apiHost } = hosts(config);
  const all: SmaregiTransaction[] = [];

  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      "transaction_date_time-from": isoJst(from, false),
      "transaction_date_time-to": isoJst(to, true),
      limit: String(PAGE_LIMIT),
      page: String(page),
    });
    const res = await fetch(`${apiHost}/${encodeURIComponent(config.contractId)}/pos/transactions?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`スマレジの取引一覧取得に失敗しました (HTTP ${res.status}): ${await res.text()}`);
    }
    const batch = (await res.json()) as SmaregiTransaction[];
    all.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
  }
  return all;
}

// スマレジ未接続でも連携〜自動仕訳の流れを試せるよう、日付から決定的に
// 生成したデモ取引を返す (同じ期間を再同期しても同じIDになるので重複取込されない)。
function demoTransactions(from: string, to: string): SmaregiTransaction[] {
  const result: SmaregiTransaction[] = [];
  const cursor = new Date(`${from}T00:00:00+09:00`);
  const end = new Date(`${to}T00:00:00+09:00`);
  while (cursor <= end) {
    const date = jstDateKey(cursor);
    const seed = Number(date.replaceAll("-", ""));
    const count = 3 + (seed % 4);
    for (let i = 0; i < count; i++) {
      const total = 500 + ((seed * (i + 7)) % 60) * 110;
      const paidByCash = (seed + i) % 3 !== 0;
      result.push({
        transactionHeadId: `demo-${date}-${i + 1}`,
        transactionDateTime: `${date}T${String(10 + i).padStart(2, "0")}:15:00+09:00`,
        transactionHeadDivision: "1",
        cancelDivision: "0",
        storeId: "1",
        total: String(total),
        taxInclude: String(Math.floor((total * 10) / 110)),
        taxExclude: "0",
        depositCash: paidByCash ? String(Math.ceil(total / 1000) * 1000) : "0",
        change: paidByCash ? String(Math.ceil(total / 1000) * 1000 - total) : "0",
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export async function fetchSmaregiSales(from: string, to: string) {
  const config = getSmaregiConfig();
  const raw = config ? await fetchTransactions(config, from, to) : demoTransactions(from, to);
  const sales = raw.map(normalizeSmaregiTransaction).filter((s): s is NormalizedPosSale => s !== null);
  return { sales, demo: !config, fetched: raw.length };
}
