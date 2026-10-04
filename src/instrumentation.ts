import type { Instrumentation } from "next";

// 本番で起きたサーバーのエラーを記録して、運営者メニューで見られるようにする
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logServerError } = await import("@/lib/errorLog");
    const error = err instanceof Error ? err : new Error(String(err));
    const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
    await logServerError({ message: error.message || "(メッセージなし)", digest, stack: error.stack, method: request.method, path: request.path, routeType: context.routeType });
  } catch (e) {
    // 記録に失敗しても、元のエラーの処理は止めない
    console.error("failed to log server error", e);
  }
};
