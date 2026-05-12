import { type NextRequest } from "next/server";
import type OpenAI from "openai";
import { getDeepseek, MODEL_IDS, getLlmProvider } from "@/lib/llm";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { tavilySearch } from "@/lib/providers/tavily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CHAT_SYSTEM = `You are an energy-transition equity analyst answering questions about this investor's book.

You have:
1. The latest thesis snapshots for every T1 ticker (provided in this system prompt).
2. The "web_search" tool for live lookups when the answer depends on current information.

Search rules — CRITICAL:
- Make AT MOST 2 web searches per response. Almost every question is answerable in 1 search or 0.
- After your searches, you MUST produce a complete written answer. Do not keep saying "let me search more" — pick the best evidence and write the answer.
- Never say "let me research" or "let me check" — just do the search if needed and answer.

Answer rules:
- Be specific. Cite tickers and the exact reason for any claim.
- Skip investment-advice disclaimers. The user runs their own book.
- Format responses in tight markdown. Bullets are fine; preambles are not.
- Start with the answer in the first sentence.`;

interface ChatBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

// OpenAI-compatible tool schema. DeepSeek tool calling follows the same shape.
const WEB_SEARCH_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information. Use this for questions about recent news, policy changes, regulatory actions, earnings reports, or any date-sensitive fact not present in the thesis snapshots.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query, phrased as a focused question or set of keywords." },
        topic: {
          type: "string",
          enum: ["general", "news"],
          description: "Use 'news' for recent / time-sensitive queries, 'general' otherwise. Defaults to 'general'.",
        },
      },
      required: ["query"],
    },
  },
};

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as ChatBody | null;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response("Bad request", { status: 400 });
  }

  try {
    await ensureBudget(supabase, user.user.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return new Response(JSON.stringify({ error: err.message, month: err.month }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    throw err;
  }

  if (getLlmProvider() !== "deepseek") {
    return new Response(
      JSON.stringify({ error: "Chat is wired for DeepSeek in this build. Set LLM_PROVIDER=deepseek." }),
      { status: 501, headers: { "content-type": "application/json" } },
    );
  }

  // Build the system prompt with latest thesis snapshots for every symbol.
  const { data: theses } = await supabase
    .from("thesis_snapshots")
    .select("symbol,status,conviction,content,generated_at")
    .eq("user_id", user.user.id)
    .order("generated_at", { ascending: false });

  const seen = new Set<string>();
  const latestPerSymbol: Array<{ symbol: string; status: string; conviction: number | null; content: string; generated_at: string }> = [];
  for (const t of theses ?? []) {
    if (!seen.has(t.symbol)) {
      seen.add(t.symbol);
      latestPerSymbol.push(t as any);
    }
  }

  const thesisContext =
    latestPerSymbol.length === 0
      ? "(no thesis snapshots yet — the agent has not run on any ticker)"
      : latestPerSymbol
          .map((t) => `[${t.symbol}] status=${t.status} conviction=${t.conviction ?? "—"}/10\n${t.content}`)
          .join("\n\n");

  const fullSystem = `${CHAT_SYSTEM}\n\n## CURRENT BOOK THESES\n\n${thesisContext}`;

  const userId = user.user.id;
  const model = MODEL_IDS.deepseek.chat;
  const client = getDeepseek();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      // OpenAI-compatible message history accumulates across the tool-use loop.
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: fullSystem },
        ...body.messages.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
      ];

      const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

      try {
        const MAX_ITER = 4;
        for (let iteration = 0; iteration < MAX_ITER; iteration++) {
          // On the FINAL iteration, force a text answer — no more tools allowed.
          // Otherwise the model can spiral into endless "let me search more"
          // preambles and never produce a usable answer.
          const isFinalIteration = iteration === MAX_ITER - 1;
          // DeepSeek V4 enables thinking mode by default — disable it on the chat
          // path. Thinking adds 5-15s of invisible reasoning tokens before any
          // text streams, which makes the UI feel frozen. Q&A with web search
          // is plenty smart without it. `thinking` is a DeepSeek extension to
          // the OpenAI schema, hence the cast.
          const completion = await client.chat.completions.create({
            model,
            max_tokens: 4096,
            messages,
            tools: isFinalIteration ? undefined : [WEB_SEARCH_TOOL],
            tool_choice: isFinalIteration ? "none" : "auto",
            stream: true,
            stream_options: { include_usage: true },
            thinking: { type: "disabled" },
          } as OpenAI.Chat.ChatCompletionCreateParamsStreaming & { thinking: { type: "disabled" } });

          let textContent = "";
          let reasoningContent = ""; // DeepSeek thinking-mode field; must be echoed back.
          const toolCallsByIdx = new Map<number, { id: string; name: string; arguments: string }>();

          for await (const chunk of completion) {
            const delta = chunk.choices?.[0]?.delta as
              | (OpenAI.Chat.ChatCompletionChunk.Choice.Delta & { reasoning_content?: string })
              | undefined;
            if (delta?.content) {
              textContent += delta.content;
              send("text", delta.content);
            }
            if (delta?.reasoning_content) {
              reasoningContent += delta.reasoning_content;
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                const existing = toolCallsByIdx.get(idx) ?? { id: "", name: "", arguments: "" };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                toolCallsByIdx.set(idx, existing);
              }
            }
            if (chunk.usage) {
              const u = chunk.usage as unknown as {
                prompt_tokens?: number;
                completion_tokens?: number;
                prompt_cache_hit_tokens?: number;
                prompt_cache_miss_tokens?: number;
              };
              const hit = u.prompt_cache_hit_tokens ?? 0;
              const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit);
              totalUsage.input_tokens += miss;
              totalUsage.cache_read_input_tokens += hit;
              totalUsage.output_tokens += u.completion_tokens ?? 0;
            }
          }

          const toolCalls = Array.from(toolCallsByIdx.values()).filter((c) => c.id && c.name);
          if (toolCalls.length === 0) break;

          // DeepSeek requires reasoning_content to be echoed back when thinking mode
          // produced it; cast lets us attach the non-standard field.
          messages.push({
            role: "assistant",
            content: textContent || null,
            tool_calls: toolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: c.arguments },
            })),
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          } as OpenAI.Chat.ChatCompletionMessageParam);

          for (const call of toolCalls) {
            send("tool_use", { name: call.name, arguments: call.arguments });
            let resultText: string;
            try {
              if (call.name === "web_search") {
                const args = JSON.parse(call.arguments || "{}");
                const r = await tavilySearch(String(args.query ?? ""), {
                  topic: args.topic === "news" ? "news" : "general",
                });
                resultText = JSON.stringify({
                  query: r.query,
                  answer: r.answer,
                  results: r.results.slice(0, 5).map((x) => ({
                    title: x.title,
                    url: x.url,
                    publishedDate: x.publishedDate,
                    snippet: x.content.slice(0, 600),
                  })),
                });
              } else {
                resultText = JSON.stringify({ error: `Unknown tool: ${call.name}` });
              }
            } catch (err) {
              resultText = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
            send("tool_result", { name: call.name });
            messages.push({ role: "tool", tool_call_id: call.id, content: resultText });
          }
        }

        await recordUsage({ userId, model, endpoint: "agent.chat", usage: totalUsage }, supabase);
        send("done", { stop_reason: "end_turn" });
        controller.close();
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
