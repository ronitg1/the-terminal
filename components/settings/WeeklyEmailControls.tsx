"use client";

import { useState } from "react";
import { Mail, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmailControlsProps {
  /** API route relative to origin, e.g. "/api/email/weekly" or "/api/email/daily". */
  apiPath: string;
  /** Button copy. */
  sendLabel?: string;
  previewLabel?: string;
}

function EmailControls({ apiPath, sendLabel, previewLabel }: EmailControlsProps) {
  const [loading, setLoading] = useState<"send" | "preview" | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" | "success" } | null>(null);

  async function send() {
    setLoading("send");
    setMessage(null);
    try {
      const res = await fetch(apiPath);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.skipped) {
        setMessage({ text: j.reason ?? "Email not configured.", tone: "info" });
      } else if (j.ok) {
        setMessage({ text: `Sent — id ${j.id ?? "(no id)"}`, tone: "success" });
      } else {
        setMessage({ text: j.error ?? "Send failed", tone: "error" });
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), tone: "error" });
    } finally {
      setLoading(null);
    }
  }

  function openPreview() {
    setLoading("preview");
    window.open(`${apiPath}?preview=1`, "_blank");
    setLoading(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={send} disabled={loading !== null}>
          <Mail className={cn("mr-1 h-3 w-3", loading === "send" && "animate-pulse")} />
          {loading === "send" ? "Sending…" : sendLabel ?? "Send to my email now"}
        </Button>
        <Button size="sm" variant="outline" onClick={openPreview} disabled={loading !== null}>
          <Eye className="mr-1 h-3 w-3" /> {previewLabel ?? "Preview HTML"}
        </Button>
      </div>
      {message && (
        <div
          className={cn(
            "rounded-md border p-2 text-xs",
            message.tone === "error" && "border-loss/40 bg-loss/10 text-loss",
            message.tone === "success" && "border-gain/40 bg-gain/10 text-gain",
            message.tone === "info" && "border-muted-foreground/40 bg-muted text-muted-foreground",
          )}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

export function WeeklyEmailControls() {
  return <EmailControls apiPath="/api/email/weekly" />;
}

export function DailyEmailControls() {
  return <EmailControls apiPath="/api/email/daily" sendLabel="Send today's brief now" />;
}
