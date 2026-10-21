import { LlmUnavailableError, type LlmMessage } from "@/llm/llmClient.js";

export const DEFAULT_OUTPUT_RESERVE_TOKENS = 4096;

/** Rough token estimate: one token per three characters. */
export function estimateTokens(messages: LlmMessage[]): number {
  const characters = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(characters / 3);
}

/** Throws LlmUnavailableError when the prompt plus the output reserve would not fit the context window. */
export function assertFitsContext(
  messages: LlmMessage[],
  { contextTokens, outputReserve = DEFAULT_OUTPUT_RESERVE_TOKENS }: { contextTokens: number; outputReserve?: number },
): void {
  const needed = estimateTokens(messages) + outputReserve;
  if (needed > contextTokens) {
    throw new LlmUnavailableError(
      `Prompt needs about ${needed} tokens (including ${outputReserve} reserved for the output) but the context budget is ${contextTokens}`,
    );
  }
}
