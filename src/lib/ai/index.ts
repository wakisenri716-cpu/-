import { ClaudeAiProvider } from "./claudeProvider";
import { MockAiProvider } from "./mockProvider";
import type { AiProvider } from "./types";

export * from "./types";

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (!cached) {
    cached = process.env.ANTHROPIC_API_KEY ? new ClaudeAiProvider() : new MockAiProvider();
  }
  return cached;
}
