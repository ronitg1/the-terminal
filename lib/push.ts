// Browser push notifications. Uses the web-push library with VAPID keys.
// VAPID_PUBLIC_KEY is exposed to the client; VAPID_PRIVATE_KEY is server-only.
// Both must be set in .env.local (generate with: npx web-push generate-vapid-keys).

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";

let vapidConfigured = false;

function ensureVapidConfigured(): { publicKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:owner@example.com";
  if (!publicKey || !privateKey) return null;
  if (!vapidConfigured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }
  return { publicKey, subject };
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;          // path to open on click, e.g. "/ai-research?symbol=FSLR"
  tag?: string;          // collapses notifications with same tag
  icon?: string;
  badge?: string;
  requireInteraction?: boolean;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Send a push to all of a user's subscriptions. Dead subscriptions (410 Gone or
// 404 Not Found) are removed automatically. Returns counts so callers can log.
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  client?: SupabaseClient,
): Promise<{ sent: number; failed: number; pruned: number; reason?: string }> {
  const cfg = ensureVapidConfigured();
  if (!cfg) {
    return { sent: 0, failed: 0, pruned: 0, reason: "VAPID keys not configured" };
  }

  const supabase = client ?? createAdminSupabase();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", userId);

  if (error) {
    console.error("sendPushToUser: failed to load subscriptions", error);
    return { sent: 0, failed: 0, pruned: 0, reason: error.message };
  }

  const subs = (data ?? []) as SubscriptionRow[];
  if (subs.length === 0) return { sent: 0, failed: 0, pruned: 0, reason: "no subscriptions" };

  const payloadStr = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  const usedIds: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payloadStr,
        );
        sent++;
        usedIds.push(s.id);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          // Subscription is dead — prune it.
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
          pruned++;
        } else {
          console.error("sendPushToUser: webpush.sendNotification failed", s.endpoint.slice(0, 64), err);
          failed++;
        }
      }
    }),
  );

  if (usedIds.length > 0) {
    await supabase
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .in("id", usedIds);
  }

  return { sent, failed, pruned };
}
