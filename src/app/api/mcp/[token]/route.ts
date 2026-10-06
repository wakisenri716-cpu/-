import { bearerOf, handleMcpPost, mcpMethodNotAllowed, mcpOptions } from "@/lib/mcp/server";

// 鍵入りのURL(ヘッダーを設定できないAIのため。claude.ai のカスタムコネクタなど)。URLを人に教えないこと
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleMcpPost(request, bearerOf(request) ?? token);
}

export const GET = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
export const OPTIONS = mcpOptions;
