import { createServerSupabase } from "@/lib/supabase/server";
import { BookTable } from "@/components/book/BookTable";
import { CorrelationHeatmap } from "@/components/book/CorrelationHeatmap";
import { EtfFlowPanel } from "@/components/book/EtfFlowPanel";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { seedTickersIfEmpty } from "@/lib/seed";
import type { Ticker } from "@/lib/types/db";

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const supabase = createServerSupabase();

  // Backstop seed: if the auth-callback seed didn't run (e.g. migration was applied
  // after first sign-in), seed on first visit instead. Idempotent — only inserts
  // when the user has zero tickers.
  const { data: user } = await supabase.auth.getUser();
  if (user.user) {
    await seedTickersIfEmpty(supabase, user.user.id);
  }

  const { data, error } = await supabase
    .from("tickers")
    .select("*")
    .order("tier", { ascending: true })
    .order("symbol", { ascending: true });

  const tickers = (data ?? []) as Ticker[];

  return (
    <div className="space-y-6">
      <ErrorBoundary label="Book table">
        <BookTable initialTickers={tickers} />
      </ErrorBoundary>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ErrorBoundary label="Correlation heatmap">
            <CorrelationHeatmap />
          </ErrorBoundary>
        </div>
        <div>
          <ErrorBoundary label="ETF flows">
            <EtfFlowPanel />
          </ErrorBoundary>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">
          DB error: {error.message}
        </div>
      )}
    </div>
  );
}
