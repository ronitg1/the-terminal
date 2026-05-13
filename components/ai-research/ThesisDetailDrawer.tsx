"use client";

import { ExternalLink } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, YAxis, XAxis, Tooltip as RechartsTooltip } from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ThesisStatusBadge } from "@/components/book/ThesisStatusBadge";
import { Separator } from "@/components/ui/separator";
import { ConvictionDial } from "./ConvictionDial";
import { timeAgo, cn } from "@/lib/utils";
import type { FeedThesisCard, ThesisCatalystOut, AnalystOut, ResearcherOut } from "@/app/api/agent/feed/route";

export function ThesisDetailDrawer({
  card,
  open,
  onOpenChange,
}: {
  card: FeedThesisCard | null;
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const data = card?.latest?.data;
  const structured = data?.structured;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        {card && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <ConvictionDial value={card.latest?.conviction ?? null} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <SheetTitle className="text-xl">{card.symbol}</SheetTitle>
                    <ThesisStatusBadge status={card.latest?.status} />
                  </div>
                  <SheetDescription className="text-xs">
                    {card.name}
                    {card.latest && ` · updated ${timeAgo(card.latest.generated_at)}`}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            {!card.latest ? (
              <div className="mt-6 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No snapshot yet — click <span className="font-medium">Run now</span> on the card.
              </div>
            ) : (
              <div className="mt-4 space-y-5">
                {data?.keyDevelopment && (
                  <section className="rounded-md border bg-secondary/40 p-3">
                    <SectionTitle>Key development</SectionTitle>
                    <p className="text-sm leading-relaxed">{data.keyDevelopment}</p>
                  </section>
                )}

                {structured?.variantView && (
                  <section>
                    <SectionTitle>Variant view</SectionTitle>
                    <p className="text-sm leading-relaxed">{structured.variantView}</p>
                  </section>
                )}

                {structured?.setup && (
                  <section>
                    <SectionTitle>Setup into print</SectionTitle>
                    <p className="text-sm leading-relaxed">{structured.setup}</p>
                  </section>
                )}

                {structured && (structured.bullCase?.narrative || structured.bearCase?.narrative) && (
                  <section>
                    <SectionTitle>Bull / bear cases</SectionTitle>
                    <div className="grid gap-2 md:grid-cols-2">
                      <CaseCard
                        label="Bull"
                        color="gain"
                        narrative={structured.bullCase?.narrative}
                        target={structured.bullCase?.targetPrice}
                        base={structured.basePrice}
                      />
                      <CaseCard
                        label="Bear"
                        color="loss"
                        narrative={structured.bearCase?.narrative}
                        target={structured.bearCase?.targetPrice}
                        base={structured.basePrice}
                      />
                    </div>
                  </section>
                )}

                {data?.multiAgent && (data.multiAgent.bull || data.multiAgent.bear) && (
                  <section>
                    <SectionTitle>Bull / bear debate</SectionTitle>
                    <div className="grid gap-2 md:grid-cols-2">
                      {data.multiAgent.bull && (
                        <ResearcherCard r={data.multiAgent.bull} />
                      )}
                      {data.multiAgent.bear && (
                        <ResearcherCard r={data.multiAgent.bear} />
                      )}
                    </div>
                  </section>
                )}

                {data?.multiAgent?.analysts && data.multiAgent.analysts.length > 0 && (
                  <section>
                    <SectionTitle>Analyst views</SectionTitle>
                    <div className="space-y-2">
                      {data.multiAgent.analysts.map((a) => (
                        <AnalystCard key={a.perspective} a={a} />
                      ))}
                    </div>
                  </section>
                )}

                {structured?.drivers && structured.drivers.length > 0 && (
                  <section>
                    <SectionTitle>Key drivers</SectionTitle>
                    <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
                      {structured.drivers.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {structured?.catalysts && structured.catalysts.length > 0 && (
                  <section>
                    <SectionTitle>Catalysts</SectionTitle>
                    <CatalystTable rows={structured.catalysts} />
                  </section>
                )}

                {structured?.positionRisks && structured.positionRisks.length > 0 && (
                  <section>
                    <SectionTitle>Position risks</SectionTitle>
                    <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
                      {structured.positionRisks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {data?.watch && data.watch.length > 0 && (
                  <section>
                    <SectionTitle>What I&apos;m watching</SectionTitle>
                    <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
                      {data.watch.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </section>
                )}

                <Separator />

                <section>
                  <SectionTitle>Full narrative</SectionTitle>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{card.latest.content}</p>
                </section>

                {card.latest.sources && card.latest.sources.length > 0 && (
                  <>
                    <Separator />
                    <section>
                      <SectionTitle>Sources</SectionTitle>
                      <ul className="mt-1 space-y-1.5 text-xs">
                        {card.latest.sources.map((s, i) => (
                          <li key={i} className="leading-snug">
                            {s.url ? (
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-start gap-1 text-tier1 hover:underline"
                              >
                                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                                <span>{s.title}</span>
                              </a>
                            ) : (
                              <span>{s.title}</span>
                            )}
                            {s.publishedAt && (
                              <span className="ml-2 text-muted-foreground">{s.publishedAt.slice(0, 10)}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  </>
                )}

                {card.history.length > 1 && (
                  <>
                    <Separator />
                    <section>
                      <SectionTitle>Conviction history</SectionTitle>
                      <div className="h-32 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={card.history}>
                            <Line
                              type="monotone"
                              dataKey="conviction"
                              stroke="hsl(var(--tier1))"
                              strokeWidth={1.5}
                              dot={{ r: 2 }}
                              isAnimationActive={false}
                            />
                            <YAxis domain={[1, 10]} width={20} tick={{ fontSize: 10 }} />
                            <XAxis
                              dataKey="generated_at"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            />
                            <RechartsTooltip
                              contentStyle={{
                                background: "hsl(var(--popover))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: 6,
                                fontSize: 11,
                              }}
                              labelFormatter={(d) => new Date(d as string).toLocaleString()}
                              formatter={(v: number, _name, payload) => [
                                `conv ${v}/10 · ${(payload as { payload?: { status?: string } }).payload?.status ?? ""}`,
                                "",
                              ]}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        {card.history.length} snapshots over time
                      </div>
                    </section>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CaseCard({
  label,
  color,
  narrative,
  target,
  base,
}: {
  label: string;
  color: "gain" | "loss";
  narrative: string | undefined;
  target: number | null | undefined;
  base: number | null | undefined;
}) {
  const upside =
    target != null && base != null && base > 0
      ? ((target - base) / base) * 100
      : null;
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <span className={cn("text-[10px] font-semibold uppercase tracking-widest", color === "gain" ? "text-gain" : "text-loss")}>
          {label}
        </span>
        {target != null && (
          <span className="font-mono text-sm">
            ${target.toFixed(2)}
            {upside != null && (
              <span className={cn("ml-1 text-[10px]", upside >= 0 ? "text-gain" : "text-loss")}>
                {upside >= 0 ? "+" : ""}{upside.toFixed(0)}%
              </span>
            )}
          </span>
        )}
      </div>
      {narrative && <p className="mt-1 text-xs leading-relaxed">{narrative}</p>}
    </div>
  );
}

function CatalystTable({ rows }: { rows: ThesisCatalystOut[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-muted-foreground">
          <tr>
            <th className="px-2 py-1 text-left">When</th>
            <th className="px-2 py-1 text-left">Event</th>
            <th className="px-2 py-1 text-center">Direction</th>
            <th className="px-2 py-1 text-right">Est impact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={i} className="border-t">
              <td className="px-2 py-1 font-mono">{c.date || "—"}</td>
              <td className="px-2 py-1">{c.event}</td>
              <td
                className={cn(
                  "px-2 py-1 text-center uppercase font-semibold",
                  c.expectedDirection === "bullish" && "text-gain",
                  c.expectedDirection === "bearish" && "text-loss",
                  c.expectedDirection === "neutral" && "text-muted-foreground",
                )}
              >
                {c.expectedDirection}
              </td>
              <td className="px-2 py-1 text-right font-mono">{c.expectedImpactPct || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResearcherCard({ r }: { r: ResearcherOut }) {
  const isBull = r.stance === "bull";
  const accent = isBull ? "text-gain" : "text-loss";
  const border = isBull ? "border-gain/40 bg-gain/5" : "border-loss/40 bg-loss/5";
  return (
    <div className={cn("rounded-md border p-3", border)}>
      <div className="flex items-baseline justify-between">
        <span className={cn("text-[10px] font-semibold uppercase tracking-widest", accent)}>
          {r.stance} researcher
        </span>
        <span className="text-xs tabular-nums">
          {r.targetPrice != null && (
            <span className={accent}>${r.targetPrice.toFixed(2)}</span>
          )}
          <span className="ml-2 text-muted-foreground">conf {r.confidence}/10</span>
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed">{r.thesis}</p>
      {r.mustBeTrue.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Must be true
          </div>
          <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-[11px]">
            {r.mustBeTrue.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AnalystCard({ a }: { a: AnalystOut }) {
  const signalColor = {
    bullish: "text-gain border-gain/40 bg-gain/10",
    bearish: "text-loss border-loss/40 bg-loss/10",
    mixed: "text-amber-500 border-amber-500/40 bg-amber-500/10",
    noise: "text-muted-foreground border-muted-foreground/30 bg-muted",
  }[a.signalQuality];
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest">{a.perspective}</span>
        <span className={cn("rounded-sm border px-1.5 py-0.5 text-[9px] uppercase", signalColor)}>
          {a.signalQuality}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed">{a.summary}</p>
      {a.bullets.length > 0 && (
        <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
          {a.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}
