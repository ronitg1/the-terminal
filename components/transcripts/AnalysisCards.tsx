import { cn } from "@/lib/utils";
import type {
  TranscriptAnalysisOutput,
  KeyTheme,
  DodgedQuestion,
  CompetitiveMention,
  PolicyMention,
} from "@/lib/agent/transcriptAnalysis";

export function AnalysisCards({ a }: { a: TranscriptAnalysisOutput }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SentimentCard score={a.sentimentScore} delta={a.toneDelta} />
        <ThesisImpactCard impact={a.thesisImpact} />
      </div>

      <Card title="Guidance language">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.guidanceLanguage || "—"}</p>
      </Card>

      {a.keyThemes.length > 0 && (
        <Card title={`Key themes (${a.keyThemes.length})`}>
          <ul className="space-y-2">
            {a.keyThemes.map((t, i) => (
              <KeyThemeRow key={i} t={t} />
            ))}
          </ul>
        </Card>
      )}

      {a.dodgedQuestions.length > 0 && (
        <Card title={`Dodged questions (${a.dodgedQuestions.length})`}>
          <ul className="space-y-2">
            {a.dodgedQuestions.map((q, i) => (
              <DodgedQuestionRow key={i} q={q} />
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {a.competitiveMentions.length > 0 && (
          <Card title={`Competitive mentions (${a.competitiveMentions.length})`}>
            <ul className="space-y-2 text-xs">
              {a.competitiveMentions.map((c, i) => (
                <CompetitiveRow key={i} c={c} />
              ))}
            </ul>
          </Card>
        )}

        {a.policyMentions.length > 0 && (
          <Card title={`Policy / regulatory (${a.policyMentions.length})`}>
            <ul className="space-y-2 text-xs">
              {a.policyMentions.map((p, i) => (
                <PolicyRow key={i} p={p} />
              ))}
            </ul>
          </Card>
        )}
      </div>

      {a.watchNextQuarter.length > 0 && (
        <Card title="Watch for next quarter">
          <ul className="list-inside list-disc space-y-1 text-sm">
            {a.watchNextQuarter.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function SentimentCard({ score, delta }: { score: number; delta: string }) {
  const color = score > 2 ? "text-gain" : score < -2 ? "text-loss" : "text-amber-500";
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Sentiment & tone
      </div>
      <div className="flex items-baseline gap-3">
        <span className={cn("font-mono text-3xl font-semibold tabular-nums", color)}>
          {score >= 0 ? "+" : ""}
          {score}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">vs prior</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{delta || "—"}</p>
    </div>
  );
}

function ThesisImpactCard({ impact }: { impact: TranscriptAnalysisOutput["thesisImpact"] }) {
  const colorByDir: Record<typeof impact.direction, string> = {
    strengthens: "border-tier1/40 bg-tier1/10 text-tier1",
    confirms: "border-gain/40 bg-gain/10 text-gain",
    weakens: "border-amber-500/40 bg-amber-500/10 text-amber-500",
    breaks: "border-loss/40 bg-loss/10 text-loss",
  };
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Thesis impact
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
          colorByDir[impact.direction],
        )}
      >
        {impact.direction}
      </span>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{impact.narrative || "—"}</p>
    </div>
  );
}

function KeyThemeRow({ t }: { t: KeyTheme }) {
  const relBadge: Record<KeyTheme["bookRelevance"], string> = {
    high: "border-tier1/40 bg-tier1/10 text-tier1",
    medium: "border-muted-foreground/40 bg-muted text-muted-foreground",
    low: "border-muted/40 bg-muted/30 text-muted-foreground/70",
  };
  return (
    <li className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">{t.topic}</span>
        <span
          className={cn(
            "rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
            relBadge[t.bookRelevance],
          )}
        >
          {t.bookRelevance} relevance
        </span>
      </div>
      {t.quote && <p className="border-l-2 border-muted pl-2 text-xs italic text-muted-foreground">&ldquo;{t.quote}&rdquo;</p>}
    </li>
  );
}

function DodgedQuestionRow({ q }: { q: DodgedQuestion }) {
  return (
    <li className="rounded-sm border bg-muted/30 p-2 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{q.analyst}</span>
        <span
          className={cn(
            "rounded-sm border px-1 text-[9px] uppercase tracking-wider",
            q.importance === "high" && "border-loss/40 bg-loss/10 text-loss",
            q.importance === "medium" && "border-amber-500/40 bg-amber-500/10 text-amber-500",
            q.importance === "low" && "border-muted-foreground/40 bg-muted text-muted-foreground",
          )}
        >
          {q.importance}
        </span>
      </div>
      <p className="mt-1"><span className="text-muted-foreground">Q:</span> {q.question}</p>
      <p className="mt-0.5"><span className="text-muted-foreground">Pivot:</span> {q.pivot}</p>
    </li>
  );
}

function CompetitiveRow({ c }: { c: CompetitiveMention }) {
  const signalColor: Record<CompetitiveMention["signal"], string> = {
    bullish: "text-gain",
    bearish: "text-loss",
    neutral: "text-muted-foreground",
  };
  return (
    <li className="space-y-0.5">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{c.competitor}</span>
        <span className={cn("text-[9px] uppercase tracking-wider", signalColor[c.signal])}>
          {c.signal}
        </span>
      </div>
      <p className="text-muted-foreground">{c.context}</p>
    </li>
  );
}

function PolicyRow({ p }: { p: PolicyMention }) {
  return (
    <li className="space-y-0.5">
      <div className="font-semibold">{p.topic}</div>
      {p.quote && <p className="border-l-2 border-muted pl-2 italic text-muted-foreground">&ldquo;{p.quote}&rdquo;</p>}
      {p.interpretation && <p>{p.interpretation}</p>}
    </li>
  );
}
