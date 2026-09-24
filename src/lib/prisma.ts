import { PrismaClient } from "@prisma/client";
import { toBooksClosedError } from "@/lib/errors";

// 締めた期間の仕訳はデータベースのトリガーが拒否する。その生のエラーを、画面に出せる日本語のエラーに置き換える。
// (問い合わせの結果の型は変えない拡張なので、型は PrismaClient のまま扱う)
function createClient() {
  return new PrismaClient().$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (error) {
          throw toBooksClosedError(error) ?? error;
        }
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
