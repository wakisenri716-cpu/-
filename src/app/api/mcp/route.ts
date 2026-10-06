import { bearerOf, handleMcpPost, mcpMethodNotAllowed, mcpOptions } from "@/lib/mcp/server";

// 自分のAIからつなぐ入り口(MCP)。鍵は Authorization: Bearer で渡す
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpPost(request, bearerOf(request));
}

export const GET = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
export const OPTIONS = mcpOptions;
