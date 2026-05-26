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

// ============================================================================
// Daily market brief — sent 5:30pm ET weekdays
// ============================================================================

export interface DailyEmailData {
  date: string;             // ISO YYYY-MM-DD
  appUrl: string;
  brief: {
    headline: string;
    marketAction: string;
    bookSummary: string;
    topHeadlines: string[];
    tomorrow: string;
    watch: string[];
  };
  marketSnapshot: Array<{ symbol: string; label: string; price: number | null; changePct: number | null }>;
  bookMoves: Array<{ symbol: string; tier: number | null; changePct: number | null; price: number | null }>;
  flips: Array<{ symbol: string; from: string; to: string; at: string }>;
  upcomingEarnings: Array<{ symbol: string; date: string; timing: "BH" | "AH" | null }>;
  macroTomorrow: Array<{ date: string; label: string }>;
  liveHeadlines: Array<{ title: string; url: string }>;
}

export function buildDailyEmailHtml(d: DailyEmailData): string {
  const { brief, marketSnapshot, bookMoves, flips, upcomingEarnings, macroTomorrow, liveHeadlines, appUrl, date } = d;

  const snapshotRows = marketSnapshot
    .map((m) => {
      const change = m.changePct;
      const color = change == null ? MUTED : change >= 0 ? GAIN : LOSS;
      const changeText = change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
      return `<tr><td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;color:${FG};">${escapeHtml(m.label)}</td><td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;color:${MUTED};text-align:right;">${m.price != null ? "$" + m.price.toFixed(2) : "—"}</td><td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;color:${color};text-align:right;">${changeText}</td></tr>`;
    })
    .join("");

  const bookRows = bookMoves
    .map((b) => {
      const change = b.changePct;
      const color = change == null ? MUTED : change >= 0 ? GAIN : LOSS;
      const changeText = change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
      const tierTag = b.tier ? `<span style="display:inline-block;padding:1px 5px;border:1px solid ${BORDER};border-radius:3px;font-size:10px;color:${MUTED};margin-right:6px;">T${b.tier}</span>` : "";
      return `<tr><td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:13px;color:${FG};">${tierTag}${escapeHtml(b.symbol)}</td><td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;color:${MUTED};text-align:right;">${b.price != null ? "$" + b.price.toFixed(2) : "—"}</td><td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;color:${color};text-align:right;">${changeText}</td></tr>`;
    })
    .join("");

  const flipsList = flips.length
    ? `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:13px;line-height:1.6;">${flips
        .map(
          (f) =>
            `<li><strong>${escapeHtml(f.symbol)}</strong>: ${escapeHtml(f.from)} → <span style="color:${f.to === "weakened" || f.to === "broken" ? LOSS : GAIN};">${escapeHtml(f.to)}</span></li>`,
        )
        .join("")}</ul>`
    : "";

  const upcomingList = upcomingEarnings.length || macroTomorrow.length
    ? `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:13px;line-height:1.6;">${[
        ...upcomingEarnings.map(
          (e) => `<li><strong>${escapeHtml(e.symbol)}</strong> earnings on ${escapeHtml(e.date)}${e.timing ? ` <span style="color:${MUTED};">(${e.timing})</span>` : ""}</li>`,
        ),
        ...macroTomorrow.map(
          (m) => `<li><strong>${escapeHtml(m.label)}</strong> <span style="color:${MUTED};">— ${escapeHtml(m.date)}</span></li>`,
        ),
      ].join("")}</ul>`
    : "";

  const headlineList = brief.topHeadlines.length
    ? `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:14px;line-height:1.6;">${brief.topHeadlines.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`
    : "";

  const watchList = brief.watch.length
    ? `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:14px;line-height:1.6;">${brief.watch.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
    : "";

  const headlinesLive = liveHeadlines.length
    ? `<ul style="margin:8px 0;padding-left:18px;font-size:12px;line-height:1.6;">${liveHeadlines
        .map((h) => `<li><a href="${h.url}" style="color:${ACCENT};text-decoration:none;">${escapeHtml(h.title)}</a></li>`)
        .join("")}</ul>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Market brief — ${date}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width:640px;margin:0 auto;background:${BG};">
    <tr><td style="padding:24px 20px 8px 20px;">
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};">The Terminal · Daily brief</div>
      <div style="font-size:13px;color:${MUTED};margin-top:2px;">${date} · post-close</div>
    </td></tr>

    <tr><td style="padding:16px 20px 8px 20px;">
      <div style="font-size:22px;font-weight:600;color:${FG};line-height:1.3;">${escapeHtml(brief.headline || "Today's brief")}</div>
    </td></tr>

    ${section("Market action", `<p style="margin:0 0 12px 0;color:${FG};font-size:14px;line-height:1.6;">${escapeHtml(brief.marketAction)}</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid ${BORDER};border-radius:6px;border-collapse:separate;">
        <thead><tr><th style="padding:5px 12px;text-align:left;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};background:#111;border-bottom:1px solid ${BORDER};">Index</th><th style="padding:5px 12px;text-align:right;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};background:#111;border-bottom:1px solid ${BORDER};">Close</th><th style="padding:5px 12px;text-align:right;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};background:#111;border-bottom:1px solid ${BORDER};">Day %</th></tr></thead>
        <tbody>${snapshotRows}</tbody>
      </table>`)}

    ${bookMoves.length > 0 ? section("Your book today", `${brief.bookSummary ? `<p style="margin:0 0 12px 0;color:${FG};font-size:14px;line-height:1.6;">${escapeHtml(brief.bookSummary)}</p>` : ""}
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid ${BORDER};border-radius:6px;border-collapse:separate;">
        <thead><tr><th style="padding:5px 12px;text-align:left;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};background:#111;border-bottom:1px solid ${BORDER};">Ticker</th><th style="padding:5px 12px;text-align:right;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};background:#111;border-bottom:1px solid ${BORDER};">Last</th><th style="padding:5px 12px;text-align:right;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};background:#111;border-bottom:1px solid ${BORDER};">Day %</th></tr></thead>
        <tbody>${bookRows}</tbody>
      </table>`) : ""}

    ${flipsList ? section("Thesis flips today", flipsList) : ""}
    ${headlineList ? section("Top headlines", headlineList) : ""}
    ${section("Tomorrow", `<p style="margin:0 0 8px 0;color:${FG};font-size:14px;line-height:1.6;">${escapeHtml(brief.tomorrow)}</p>${upcomingList}`)}
    ${watchList ? section("Watch list", watchList) : ""}
    ${headlinesLive ? section("Sources", headlinesLive) : ""}

    <tr><td style="padding:16px 20px 32px 20px;">
      <a href="${appUrl}" style="display:inline-block;padding:10px 16px;background:${ACCENT};color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">Open The Terminal</a>
    </td></tr>

    <tr><td style="padding:0 20px 24px 20px;border-top:1px solid ${BORDER};">
      <div style="margin-top:16px;font-size:11px;color:${MUTED};">Auto-generated daily at 5:30pm ET on weekdays. Adjust delivery in Settings.</div>
    </td></tr>
  </table>
</body></html>`;
}

export function buildDailyEmailText(d: DailyEmailData): string {
  const lines: string[] = [];
  lines.push(`THE TERMINAL — Daily brief, ${d.date}`);
  lines.push("");
  lines.push(d.brief.headline || "Today's brief");
  lines.push("");
  lines.push("MARKET ACTION");
  lines.push(d.brief.marketAction);
  for (const m of d.marketSnapshot) {
    lines.push(`  ${m.label} (${m.symbol}): ${m.price != null ? "$" + m.price.toFixed(2) : "—"}, ${m.changePct != null ? (m.changePct >= 0 ? "+" : "") + m.changePct.toFixed(2) + "%" : "—"}`);
  }

  if (d.bookMoves.length) {
    lines.push("");
    lines.push("YOUR BOOK TODAY");
    if (d.brief.bookSummary) lines.push(d.brief.bookSummary);
    for (const b of d.bookMoves) {
      lines.push(`  ${b.tier ? `T${b.tier} ` : ""}${b.symbol}: $${b.price?.toFixed(2) ?? "?"} ${b.changePct != null ? (b.changePct >= 0 ? "+" : "") + b.changePct.toFixed(2) + "%" : "—"}`);
    }
  }

  if (d.flips.length) {
    lines.push("");
    lines.push("THESIS FLIPS TODAY");
    for (const f of d.flips) lines.push(`  ${f.symbol}: ${f.from} → ${f.to}`);
  }

  if (d.brief.topHeadlines.length) {
    lines.push("");
    lines.push("TOP HEADLINES");
    for (const h of d.brief.topHeadlines) lines.push(`  - ${h}`);
  }

  lines.push("");
  lines.push("TOMORROW");
  lines.push(d.brief.tomorrow);
  for (const e of d.upcomingEarnings) lines.push(`  ${e.symbol} on ${e.date}${e.timing ? ` (${e.timing})` : ""}`);
  for (const m of d.macroTomorrow) lines.push(`  ${m.label} — ${m.date}`);

  if (d.brief.watch.length) {
    lines.push("");
    lines.push("WATCH");
    for (const w of d.brief.watch) lines.push(`  - ${w}`);
  }

  lines.push("");
  lines.push(`Open: ${d.appUrl}`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
