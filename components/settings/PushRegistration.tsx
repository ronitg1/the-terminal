"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getCurrentSubscription,
  getPushPermission,
  sendTestPush,
  subscribePush,
  unsubscribePush,
  type PushPermission,
} from "@/lib/push-client";

type Status = "idle" | "loading";

export function PushRegistration() {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" | "success" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = getPushPermission();
      if (cancelled) return;
      setPermission(p);
      if (p === "unsupported") return;
      const sub = await getCurrentSubscription();
      if (!cancelled) setSubscribed(sub !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setStatus("loading");
    setMessage(null);
    const res = await subscribePush();
    setPermission(getPushPermission());
    if (res.ok) {
      setSubscribed(true);
      setMessage({ text: "Push notifications enabled.", tone: "success" });
    } else {
      setMessage({ text: res.error ?? "Failed to enable push", tone: "error" });
    }
    setStatus("idle");
  }

  async function disable() {
    setStatus("loading");
    setMessage(null);
    const res = await unsubscribePush();
    if (res.ok) {
      setSubscribed(false);
      setMessage({ text: "Push notifications disabled.", tone: "info" });
    } else {
      setMessage({ text: res.error ?? "Failed to disable", tone: "error" });
    }
    setStatus("idle");
  }

  async function test() {
    setStatus("loading");
    setMessage(null);
    const res = await sendTestPush();
    if (res.ok) {
      setMessage({
        text: res.sent > 0 ? `Test push sent (${res.sent} device${res.sent === 1 ? "" : "s"}).` : "No devices subscribed.",
        tone: res.sent > 0 ? "success" : "info",
      });
    } else {
      setMessage({ text: res.error ?? "Test push failed", tone: "error" });
    }
    setStatus("idle");
  }

  if (permission === "unsupported") {
    return (
      <div className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
        This browser doesn&apos;t support web push notifications.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!subscribed ? (
          <Button size="sm" onClick={enable} disabled={status === "loading" || permission === "denied"}>
            <Bell className="mr-1 h-3 w-3" />
            {status === "loading" ? "Enabling…" : "Enable on this browser"}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={disable} disabled={status === "loading"}>
              <BellOff className="mr-1 h-3 w-3" />
              {status === "loading" ? "Disabling…" : "Disable on this browser"}
            </Button>
            <Button size="sm" variant="ghost" onClick={test} disabled={status === "loading"}>
              <Send className="mr-1 h-3 w-3" /> Send test
            </Button>
          </>
        )}
        <span
          className={cn(
            "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
            subscribed
              ? "border-gain/40 bg-gain/10 text-gain"
              : permission === "denied"
              ? "border-loss/40 bg-loss/10 text-loss"
              : "border-muted-foreground/40 bg-muted text-muted-foreground",
          )}
        >
          {subscribed
            ? "Active"
            : permission === "denied"
            ? "Permission denied"
            : "Inactive"}
        </span>
      </div>
      {permission === "denied" && (
        <p className="text-[11px] text-muted-foreground">
          Notification permission is denied for this site. Re-enable in the browser&apos;s site settings, then refresh.
        </p>
      )}
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
