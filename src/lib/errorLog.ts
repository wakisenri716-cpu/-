import { prisma } from "@/lib/prisma";

// 本番のエラーの記録(instrumentation.ts から呼ぶ。認証などに依存しないよう別のファイルにしている)

const KEEP_DAYS = 90;

export async function logServerError(input: { message: string; digest?: string; stack?: string; method?: string; path?: string; routeType?: string }) {
  await prisma.errorLog.create({
    data: {
      message: input.message.slice(0, 1000),
      digest: input.digest?.slice(0, 100),
      stack: input.stack?.slice(0, 4000),
      method: input.method?.slice(0, 10),
      // 個人情報が入りうるクエリ文字列は残さない
      path: input.path?.split("?")[0].slice(0, 300),
      routeType: input.routeType?.slice(0, 20),
    },
  });
  // ときどき古いものを消す
  if (Math.random() < 0.05) await prisma.errorLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
}
