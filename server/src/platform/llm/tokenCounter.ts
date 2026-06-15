/**
 * Token Counter — provider-aware token estimation for fallback scenarios.
 *
 * When the LLM API response includes actual usage metadata (preferred),
 * this module's estimates are not used. They serve as a fallback for:
 * - Streaming responses where usage is not yet available
 * - Providers that don't return usage metadata
 * - Cost preview before making an API call
 */

// Regex to detect CJK characters (Han script + common punctuation)
const CJK_RE = /\p{Script=Han}/u;

/** Estimate token count for mixed Chinese/English text.
 *  Modern tokenizers: Chinese ≈ 1.5 tokens/char, English ≈ 4 chars/token.
 *  Conservative estimate for long-form novel budgeting.
 */
export function estimateTokens(text: string): number {
  let chineseChars = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) chineseChars++;
  }
  return Math.ceil(chineseChars * 1.5 + (text.length - chineseChars) / 4);
}

/** Estimate cost in USD for a given provider and token counts. */
export function estimateCost(
  provider: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PROVIDER_PRICING[provider] ?? PROVIDER_PRICING.deepseek;
  return (inputTokens / 1_000_000) * pricing.input +
         (outputTokens / 1_000_000) * pricing.output;
}

/** USD per 1M tokens — approximate, update periodically */
const PROVIDER_PRICING: Record<string, { input: number; output: number }> = {
  deepseek:  { input: 0.27, output: 1.10 },
  openai:    { input: 2.50, output: 10.00 },
  anthropic: { input: 3.00, output: 15.00 },
  gemini:    { input: 1.25, output: 5.00 },
  qwen:      { input: 0.50, output: 2.00 },
  moonshot:  { input: 1.00, output: 2.00 },
};

export { PROVIDER_PRICING };
