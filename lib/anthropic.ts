/**
 * Deprecated compatibility shim.
 *
 * New code should import from "@/lib/llm". This file remains during the
 * migration so older tests or modules that still reference "@/lib/llm"
 * keep working while the provider-neutral LLM layer owns the implementation.
 */
export {
  ai,
  completeBlocks,
  extractJSON,
  repairJSON,
  LLMError as AnthropicError,
} from "@/lib/llm";
export type { AI, AIMessage, AIOptions } from "@/lib/llm";
export { DEFAULT_ANTHROPIC_MODEL as MODEL, DEFAULT_MAX_TOKENS as MAX_TOKENS } from "@/lib/llm/config";
