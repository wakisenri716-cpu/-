import { ClaudeAiProvider } from "./claudeProvider";
import { MockAiProvider } from "./mockProvider";
import { aiFor } from "./access";
import type { AiProvider } from "./types";

export * from "./types";

const mock = new MockAiProvider();

// 会社のAIの設定(AI込み/AI持ち込み)に合わせた読み取り役。AIが使えなければモック(ファイル名などで判定)
export async function getAiProvider(companyId: string): Promise<AiProvider> {
  const client = await aiFor(companyId);
  return client ? new ClaudeAiProvider(client) : mock;
}
