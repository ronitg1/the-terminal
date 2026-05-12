"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  toolUses?: Array<{ name: string; query?: string }>;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(next);
    setStreaming(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.slice(0, -1) }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep trailing partial
        let event = "";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
          else if (line === "" && event) {
            handleEvent(event, data);
            event = "";
            data = "";
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
    }
  }

  function handleEvent(event: string, data: string) {
    if (event === "text") {
      const delta = safeParse(data) as string;
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: last.content + delta };
        }
        return copy;
      });
    } else if (event === "tool_use") {
      const t = safeParse(data) as { name?: string; arguments?: string };
      let query: string | undefined;
      try {
        const parsed = t.arguments ? (JSON.parse(t.arguments) as { query?: string }) : undefined;
        query = parsed?.query;
      } catch {
        // ignore parse errors on partial JSON
      }
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = {
            ...last,
            toolUses: [...(last.toolUses ?? []), { name: t.name ?? "tool", query }],
          };
        }
        return copy;
      });
    } else if (event === "error") {
      const e = safeParse(data) as { message?: string };
      setError(e?.message ?? "Agent error");
    }
  }

  return (
    <div className="flex h-full flex-col rounded-md border bg-card">
      <div className="border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Ask the agent
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {messages.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            Ask anything about your book. The agent uses your latest thesis snapshots + web search.
            <div className="mt-2 space-y-1 text-[11px]">
              <ExampleQ text="what's the biggest risk to FSLR going into earnings?" onPick={setInput} />
              <ExampleQ text="compare thesis strength across all T1 names" onPick={setInput} />
              <ExampleQ text="any IRA / 45X policy news in the last 48h?" onPick={setInput} />
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={cn("rounded-md p-2 text-xs", m.role === "user" ? "bg-secondary" : "bg-accent")}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {m.role === "user" ? "You" : "Agent"}
              </div>
              {m.toolUses && m.toolUses.length > 0 && (
                <div className="mb-1.5 space-y-1">
                  {m.toolUses.map((t, j) => (
                    <div
                      key={j}
                      className="inline-flex items-center gap-1 rounded-sm border border-tier1/40 bg-tier1/10 px-1.5 py-0.5 text-[10px] text-tier1"
                    >
                      <span className="font-semibold uppercase tracking-wider">
                        {t.name === "web_search" ? "Searching" : t.name}
                      </span>
                      {t.query && <span className="opacity-80">— {t.query}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="whitespace-pre-wrap">
                {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))
        )}
        {error && <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{error}</div>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 border-t p-2"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Ask the agent…"
          disabled={streaming}
          className="resize-none"
        />
        <Button type="submit" size="icon" disabled={streaming || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

function ExampleQ({ text, onPick }: { text: string; onPick: (s: string) => void }) {
  return (
    <button
      onClick={() => onPick(text)}
      className="block w-full rounded-sm border border-dashed px-2 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {text}
    </button>
  );
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
