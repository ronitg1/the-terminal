// Lenient JSON parser for LLM output. DeepSeek + Claude both occasionally emit:
//   - trailing commas in arrays/objects
//   - C-style comments (// or /* */)
//   - markdown fences around the JSON
//   - leading prose before the actual JSON block
// We try a strict parse first; if that fails, we strip the common artifacts and
// retry. If that fails, we extract the first balanced {...} block and try again.

export function parseLenientJson<T = unknown>(raw: string): T {
  const stripped = stripFences(raw).trim();

  // 1. Strict parse.
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // fall through
  }

  // 2. Sanitize trailing commas + comments, retry.
  const sanitized = sanitize(stripped);
  try {
    return JSON.parse(sanitized) as T;
  } catch {
    // fall through
  }

  // 3. Extract the first balanced {...} block (handles preamble like
  //    "Here is the analysis: { ... }").
  const block = extractFirstJsonBlock(sanitized) ?? extractFirstJsonBlock(stripped);
  if (block) {
    try {
      return JSON.parse(block) as T;
    } catch {
      // fall through
    }
    try {
      return JSON.parse(sanitize(block)) as T;
    } catch {
      // fall through
    }
  }

  throw new Error(`Could not parse JSON from LLM output (len=${raw.length}). Tail: ${raw.slice(-400)}`);
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}

function sanitize(s: string): string {
  return (
    s
      // Remove // line comments (not inside strings — naive but works most of the time)
      .replace(/(^|[^:"])\/\/[^\n]*/g, "$1")
      // Remove /* ... */ block comments
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Remove trailing commas before } or ]
      .replace(/,(\s*[}\]])/g, "$1")
  );
}

// Walk the string and find the first { ... } block with balanced braces,
// ignoring braces inside string literals.
function extractFirstJsonBlock(s: string): string | null {
  let start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
