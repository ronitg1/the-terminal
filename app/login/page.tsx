"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const supabase = getBrowserSupabase();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-md border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">The Terminal</div>
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-xs text-muted-foreground">Enter your email — a magic link will arrive shortly.</p>
        </div>

        {status === "sent" ? (
          <div className="rounded-md border border-gain/40 bg-gain/10 p-3 text-sm">
            Check your inbox at <span className="font-medium">{email}</span> for the magic link.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "sending"}
              />
            </div>
            <Button type="submit" disabled={status === "sending" || !email} className="w-full">
              {status === "sending" ? "Sending…" : "Send magic link"}
            </Button>
            {error && <p className="text-xs text-loss">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
