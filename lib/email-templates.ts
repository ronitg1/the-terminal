// Inline-styled HTML email templates. Kept here (not in /components) because
// email HTML is fundamentally different from JSX-rendered UI — fixed widths,
// inline styles, no Tailwind, table layouts.

const BG = "#0a0a0a";
const FG = "#e5e5e5";
const MUTED = "#8a8a8a";
const ACCENT = "#3b82f6";
const GAIN = "#22c55e";
const LOSS = "#ef4444";
const BORDER = "#262626";

export interface WeeklyEmailData {
  userLabel: string;
  weekOfIso: string;            // e.g. "2026-05-12"
  appUrl: string;               // base URL for clickthrough links

  summary: {
    headline: string;
    performance: string;
    thesisChanges: string;
    upcoming: string;
    callToAction: string[];
  };

  perfTable: Array<{ symbol: string; tier: number | null; returnPct: number | null }>;
  benchmarkReturnPct: number | null;
  benchmarkLabel: string;

  transitions: Array<{ symbol: string; from: string; to: string; at: string }>;
  upcomingEarnings: Array<{ symbol: string; date: string | null; daysUntil: number | null; timing: "BH" | "AH" | null }>;
}

export function buildWeeklyEmailHtml(data: WeeklyEmailData): string {
  const { summary, perfTable, benchmarkReturnPct, benchmarkLabel, transitions, upcomingEarnings, appUrl, weekOfIso } = data;

  const perfRows = perfTable
    .map((p) => {
      const r = p.returnPct;
      const color = r == null ? MUTED : r >= 0 ? GAIN : LOSS;
      const rText = r == null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}%`;
      const tierTag = p.tier ? `<span style="display:inline-block;padding:1px 5px;border:1px solid ${BORDER};border-radius:3px;font-size:10px;color:${MUTED};margin-right:6px;">T${p.tier}</span>` : "";
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:13px;color:${FG};">${tierTag}${p.symbol}</td><td style="padding:6px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:13px;color:${color};text-align:right;">${rText}</td></tr>`;
    })
    .join("");

  const benchRow =
    benchmarkReturnPct != null
      ? `<tr><td style="padding:6px 12px;border-top:2px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;color:${MUTED};">${benchmarkLabel}</td><td style="padding:6px 12px;border-top:2px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;color:${benchmarkReturnPct >= 0 ? GAIN : LOSS};text-align:right;">${benchmarkReturnPct >= 0 ? "+" : ""}${benchmarkReturnPct.toFixed(2)}%</td></tr>`
      : "";

  const transitionsList = transitions.length
    ? `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:13px;line-height:1.6;">${transitions
        .map(
          (t) =>
            `<li><strong>${t.symbol}</strong>: ${t.from} → <span style="color:${t.to === "weakened" || t.to === "broken" ? LOSS : GAIN};">${t.to}</span> <span style="color:${MUTED};">(${t.at.slice(0, 10)})</span></li>`,
        )
        .join("")}</ul>`
    : `<p style="color:${MUTED};font-size:13px;font-style:italic;">No status changes this week.</p>`;

  const upcomingList = upcomingEarnings.length
    ? `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:13px;line-height:1.6;">${upcomingEarnings
        .map(
          (e) =>
            `<li><strong>${e.symbol}</strong> on ${e.date}${e.timing ? ` <span style="color:${MUTED};">(${e.timing})</span>` : ""}${e.daysUntil != null ? ` <span style="color:${MUTED};">— ${e.daysUntil}d</span>` : ""}</li>`,
        )
        .join("")}</ul>`
    : `<p style="color:${MUTED};font-size:13px;font-style:italic;">No earnings in your book over the next 10 days.</p>`;

  const ctaList = summary.callToAction.length
    ? `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:14px;line-height:1.6;">${summary.callToAction.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>The Terminal — week of ${weekOfIso}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width:640px;margin:0 auto;background:${BG};">
    <tr><td style="padding:24px 20px 8px 20px;">
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};">The Terminal · Sunday recap</div>
      <div style="font-size:13px;color:${MUTED};margin-top:2px;">Week of ${weekOfIso}</div>
    </td></tr>

    <tr><td style="padding:16px 20px 8px 20px;">
      <div style="font-size:22px;font-weight:600;color:${FG};line-height:1.3;">${escapeHtml(summary.headline || "Weekly recap")}</div>
    </td></tr>

    ${section("Performance", `<p style="margin:0 0 12px 0;color:${FG};font-size:14px;line-height:1.6;">${escapeHtml(summary.performance)}</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid ${BORDER};border-radius:6px;border-collapse:separate;">
        <thead><tr><th style="padding:6px 12px;text-align:left;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};background:#111;border-bottom:1px solid ${BORDER};">Ticker</th><th style="padding:6px 12px;text-align:right;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};background:#111;border-bottom:1px solid ${BORDER};">5-day</th></tr></thead>
        <tbody>${perfRows}${benchRow}</tbody>
      </table>`)}

    ${section("Thesis status changes", `<p style="margin:0 0 8px 0;color:${FG};font-size:14px;line-height:1.6;">${escapeHtml(summary.thesisChanges)}</p>${transitionsList}`)}

    ${section("Upcoming (next 10 days)", `<p style="margin:0 0 8px 0;color:${FG};font-size:14px;line-height:1.6;">${escapeHtml(summary.upcoming)}</p>${upcomingList}`)}

    ${summary.callToAction.length ? section("Watch list this week", ctaList) : ""}

    <tr><td style="padding:16px 20px 32px 20px;">
      <a href="${appUrl}" style="display:inline-block;padding:10px 16px;background:${ACCENT};color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">Open The Terminal</a>
    </td></tr>

    <tr><td style="padding:0 20px 24px 20px;border-top:1px solid ${BORDER};">
      <div style="margin-top:16px;font-size:11px;color:${MUTED};">Auto-generated weekly. Adjust delivery in Settings.</div>
    </td></tr>
  </table>
</body></html>`;
}

function section(title: string, inner: string): string {
  return `<tr><td style="padding:16px 20px 8px 20px;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">${title}</div>
    ${inner}
  </td></tr>`;
}

export function buildWeeklyEmailText(data: WeeklyEmailData): string {
  const lines: string[] = [];
  lines.push(`THE TERMINAL — week of ${data.weekOfIso}`);
  lines.push("");
  lines.push(data.summary.headline || "Weekly recap");
  lines.push("");
  lines.push("PERFORMANCE");
  lines.push(data.summary.performance);
  for (const p of data.perfTable) {
    const r = p.returnPct;
    lines.push(`  ${p.tier ? `T${p.tier} ` : ""}${p.symbol}: ${r == null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}%`}`);
  }
  if (data.benchmarkReturnPct != null) {
    lines.push(`  ${data.benchmarkLabel}: ${data.benchmarkReturnPct >= 0 ? "+" : ""}${data.benchmarkReturnPct.toFixed(2)}%`);
  }
  lines.push("");
  lines.push("THESIS STATUS CHANGES");
  lines.push(data.summary.thesisChanges);
  for (const t of data.transitions) lines.push(`  ${t.symbol}: ${t.from} → ${t.to}`);
  lines.push("");
  lines.push("UPCOMING");
  lines.push(data.summary.upcoming);
  for (const e of data.upcomingEarnings)
    lines.push(`  ${e.symbol} on ${e.date}${e.timing ? ` (${e.timing})` : ""}${e.daysUntil != null ? ` — ${e.daysUntil}d` : ""}`);
  if (data.summary.callToAction.length) {
    lines.push("");
    lines.push("WATCH THIS WEEK");
    for (const c of data.summary.callToAction) lines.push(`  - ${c}`);
  }
  lines.push("");
  lines.push(`Open: ${data.appUrl}`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
