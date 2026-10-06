import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistant/tools";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { appUrl } from "@/lib/mail";
import { authenticateMcp, countMcpCall, DAILY_CALLS, type McpCaller } from "./tokens";

// 会社が自分のAI(Claude など)からこのサービスにつなぐ入り口(MCP の Streamable HTTP。応答はいつも JSON で返し、接続の状態は持たない)。
// 道具は AIアシスタントと同じもの: get_ などは読むだけ、propose_ は下書きを作るだけで、確定は人が画面(/ai-proposals)で行う。

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "keiri-automation", title: "AI経理オートメーション", version: "1.0.0" };
const READ_ONLY = /^(get_|list_|search_)/;

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Reply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export const MCP_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...MCP_CORS, ...headers } });
const fail = (id: JsonRpc["id"], code: number, message: string): Reply => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function mcpTools() {
  return ASSISTANT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
    annotations: READ_ONLY.test(t.name) ? { readOnlyHint: true, openWorldHint: false } : { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }));
}

function instructions(caller: McpCaller, base: string) {
  return [
    `「${caller.companyName}」の会計・請求・経費のデータにつながっています(${caller.user.name}さんの権限)。金額は円の整数です。`,
    "get_・list_・search_ で始まる道具はデータを読むだけです。",
    `propose_ で始まる道具は下書きを作るだけで、まだ確定しません。下書きを作ったら、利用者に「${base}/ai-proposals を開いて内容を確かめ、『実行する』を押してください」と伝えてください(24時間で期限切れ)。`,
    "結果の link・screen は、その内容を確かめられる画面のURLです。",
  ].join("\n");
}

// 結果の中の画面のパス(link・screen)を、そのまま開けるURLにする
function absolutize(value: unknown, base: string): unknown {
  if (Array.isArray(value)) return value.map((v) => absolutize(v, base));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, (k === "link" || k === "screen") && typeof v === "string" && v.startsWith("/") ? base + v : absolutize(v, base)]));
  }
  return value;
}

async function callTool(caller: McpCaller, params: Record<string, unknown>, base: string) {
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
  const text = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], isError });
  if (!(await countMcpCall(caller.tokenId))) return text(`今日はこれ以上使えません(1日${DAILY_CALLS}回まで)。明日またお試しください`, true);
  try {
    const result = (await runAssistantTool({ companyId: caller.companyId, userId: caller.user.id, source: "MCP", sourceName: caller.tokenName }, name, args)) as Record<string, unknown> | null;
    if (result && typeof result === "object" && "error" in result) return text(result, true);
    if (name.startsWith("propose_") && result && "proposalId" in result) {
      await audit("自分のAIが下書きを作成", `${caller.tokenName}: ${String(result.summary ?? "")}`, caller.user);
      return text({ ...result, confirmUrl: `${base}/ai-proposals` });
    }
    return text(absolutize(result, base));
  } catch (error) {
    if (error instanceof UserError) return text(error.message, true);
    console.error("mcp tool failed", name, error);
    return text("道具を使えませんでした(サービス側のエラー)。少し待ってからお試しください", true);
  }
}

async function handle(msg: JsonRpc, caller: McpCaller, base: string): Promise<Reply | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid Request");
  // お知らせ(id なし)には返事をしない
  if (msg.id === undefined || msg.id === null) return null;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  const ok = (result: unknown): Reply => ({ jsonrpc: "2.0", id: msg.id!, result });
  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({ protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: instructions(caller, base) });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: mcpTools() });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!ASSISTANT_TOOLS.some((t) => t.name === name)) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      return ok(await callTool(caller, params, base));
    }
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export function bearerOf(request: Request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

export async function handleMcpPost(request: Request, token: string | null) {
  const caller = await authenticateMcp(token);
  if ("error" in caller) return json(fail(null, -32001, caller.error), 401, { "WWW-Authenticate": 'Bearer realm="mcp"' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(fail(null, -32700, "Parse error"), 400);
  }
  const base = appUrl(request);
  if (Array.isArray(body)) {
    if (!body.length) return json(fail(null, -32600, "Invalid Request"), 400);
    const replies = (await Promise.all(body.slice(0, 20).map((m) => handle(m as JsonRpc, caller, base)))).filter((r): r is Reply => r !== null);
    return replies.length ? json(replies) : new Response(null, { status: 202, headers: MCP_CORS });
  }
  const reply = await handle(body as JsonRpc, caller, base);
  return reply ? json(reply) : new Response(null, { status: 202, headers: MCP_CORS });
}

// 接続の状態を持たないので、サーバーからの通知の通り道(GET)と切断(DELETE)はない
export function mcpMethodNotAllowed() {
  return new Response(null, { status: 405, headers: { ...MCP_CORS, Allow: "POST, OPTIONS" } });
}

export function mcpOptions() {
  return new Response(null, { status: 204, headers: MCP_CORS });
}
