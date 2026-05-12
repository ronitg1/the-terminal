import Anthropic from "@anthropic-ai/sdk";

// Heavy reasoning paths (thesis snapshots, trade-idea synthesis) use Sonnet.
// Lookup / synthesis chat uses Haiku — ~3× cheaper, fine for "answer from
// the supplied thesis snapshots + a quick web search" shaped questions.
export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const CLAUDE_CHAT_MODEL = "claude-haiku-4-5";

let _client: Anthropic | undefined;

export function getClaude(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  _client = new Anthropic({ apiKey });
  return _client;
}

// Extracts the joined text from a non-streaming response.
export function joinText(content: Anthropic.ContentBlock[]): string {
  return content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}
