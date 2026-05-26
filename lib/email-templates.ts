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
// Bloomberg-style layout: index table with day/MTD/YTD, macro tiles, sector
// performance, gainer/decliner cards with reasons, frame-watch + calendar.

export type MarketTone = "Bullish" | "Bearish" | "Mixed" | "Risk-Off" | "Risk-On";

export interface DailyIndexRow {
  symbol: string;
  name: string;
  level: number | null;
  dayChgPct: number | null;
  mtdPct: number | null;
  ytdPct: number | null;
}

export interface DailyMacroTile {
  symbol: string;
  label: string;
  value: number | null;
  changePct: number | null;
  isYield: boolean;
}

export interface DailySectorRow {
  symbol: string;
  name: string;
  changePct: number | null;
}

export interface DailyMover {
  ticker: string;
  name: string;
  pct: string;
  reason: string;
}

export interface DailyBriefBlock {
  date: string;
  market_tone: MarketTone;
  synopsis: string;
  notable_gainers: DailyMover[];
  notable_decliners: DailyMover[];
  calendar_ahead: string;
  frame_watch: string;
}

export interface DailyEmailData {
  date: string;             // ISO YYYY-MM-DD
  dateLabel: string;        // human label e.g. "Tuesday, May 27, 2026"
  appUrl: string;
  frameLabel: string;       // user's dominant industry frame (e.g. "Energy transition")
  brief: DailyBriefBlock;
  indexRows: DailyIndexRow[];
  macroTiles: DailyMacroTile[];
  sectorRows: DailySectorRow[];
  bookMoves: Array<{ symbol: string; name: string | null; tier: number | null; changePct: number | null; price: number | null }>;
  flips: Array<{ symbol: string; from: string; to: string; at: string }>;
  upcomingEarnings: Array<{ symbol: string; date: string; timing: "BH" | "AH" | null }>;
  macroTomorrow: Array<{ date: string; label: string }>;
}

const TONE_COLORS: Record<MarketTone, { fg: string; bg: string }> = {
  Bullish:    { fg: "#00897b", bg: "#0d2826" },
  "Risk-On":  { fg: "#00897b", bg: "#0d2826" },
  Bearish:    { fg: "#c62828", bg: "#2a0e10" },
  "Risk-Off": { fg: "#c62828", bg: "#2a0e10" },
  Mixed:      { fg: "#e65100", bg: "#2a1a0a" },
};

function pctSpan(v: number | null | undefined, opts?: { bold?: boolean }): string {
  if (v == null || !Number.isFinite(v)) {
    return `<span style="color:${MUTED}">—</span>`;
  }
  const c = v >= 0 ? GAIN : LOSS;
  const arrow = v >= 0 ? "▲" : "▼";
  const weight = opts?.bold === false ? 500 : 600;
  return `<span style="color:${c};font-weight:${weight}">${arrow} ${v >= 0 ? "+" : ""}${v.toFixed(2)}%</span>`;
}

function fmtLevel(v: number | null | undefined, prefix = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${prefix}${v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export function buildDailyEmailHtml(d: DailyEmailData): string {
  const { brief, indexRows, macroTiles, sectorRows, bookMoves, flips, upcomingEarnings, macroTomorrow, appUrl, dateLabel, frameLabel } = d;
  const tone = TONE_COLORS[brief.market_tone] ?? TONE_COLORS.Mixed;

  // Index table — Day / MTD / YTD columns.
  const indexTable = indexRows
    .map((r) => `<tr>
      <td style="padding:7px 12px;border-bottom:1px solid ${BORDER};font-weight:600;font-size:13px;color:${FG}">${escapeHtml(r.name)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid ${BORDER};text-align:right;color:${MUTED};font-family:'Menlo','SF Mono',monospace;font-size:12px">${fmtLevel(r.level, "$")}</td>
      <td style="padding:7px 12px;border-bottom:1px solid ${BORDER};text-align:right;font-family:'Menlo','SF Mono',monospace;font-size:12px">${pctSpan(r.dayChgPct)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid ${BORDER};text-align:right;font-family:'Menlo','SF Mono',monospace;font-size:12px">${pctSpan(r.mtdPct)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid ${BORDER};text-align:right;font-family:'Menlo','SF Mono',monospace;font-size:12px">${pctSpan(r.ytdPct)}</td>
    </tr>`)
    .join("");

  // Macro tiles split into two rows: non-yields (top), yields (bottom).
  const nonYieldTiles = macroTiles.filter((t) => !t.isYield);
  const yieldTiles = macroTiles.filter((t) => t.isYield);

  const renderTile = (t: DailyMacroTile): string => {
    const display = t.value == null ? "—" : t.isYield ? `${t.value.toFixed(2)}%` : t.value.toFixed(2);
    return `<td style="padding:10px 8px;text-align:center;background:#111;border-radius:6px;border:1px solid ${BORDER};">
      <div style="font-size:9px;color:${MUTED};font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">${escapeHtml(t.label)}</div>
      <div style="font-size:14px;font-weight:700;color:${FG};font-family:'Menlo','SF Mono',monospace">${display}</div>
      <div style="font-size:10px;margin-top:2px;font-family:'Menlo','SF Mono',monospace">${pctSpan(t.changePct, { bold: false })}</div>
    </td>`;
  };

  const macroTilesHtml = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;border-spacing:6px 6px">
    <tr>${nonYieldTiles.map(renderTile).join("")}</tr>
    ${yieldTiles.length > 0 ? `<tr>${yieldTiles.map(renderTile).join("")}${nonYieldTiles.length > yieldTiles.length ? `<td colspan="${nonYieldTiles.length - yieldTiles.length}"></td>` : ""}</tr>` : ""}
  </table>`;

  // Sector grid.
  const sectorTable = sectorRows
    .map((s) => `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};font-size:12px;color:${FG}">${escapeHtml(s.name)} <span style="color:${MUTED};font-size:10px">(${s.symbol})</span></td>
      <td style="padding:5px 8px;border-bottom:1px solid ${BORDER};text-align:right;font-family:'Menlo','SF Mono',monospace;font-size:12px">${pctSpan(s.changePct)}</td>
    </tr>`)
    .join("");

  // Gainer / decliner cards.
  const gainerRows = brief.notable_gainers
    .map((g) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-weight:700;color:${GAIN};font-size:12px;white-space:nowrap;font-family:'Menlo','SF Mono',monospace">${escapeHtml(g.ticker)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};color:${GAIN};font-weight:700;white-space:nowrap;font-size:12px;font-family:'Menlo','SF Mono',monospace">${escapeHtml(g.pct)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${FG}">${g.name ? `<strong>${escapeHtml(g.name)}</strong> — ` : ""}${escapeHtml(g.reason)}</td>
    </tr>`)
    .join("");

  const declinerRows = brief.notable_decliners
    .map((d_) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-weight:700;color:${LOSS};font-size:12px;white-space:nowrap;font-family:'Menlo','SF Mono',monospace">${escapeHtml(d_.ticker)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};color:${LOSS};font-weight:700;white-space:nowrap;font-size:12px;font-family:'Menlo','SF Mono',monospace">${escapeHtml(d_.pct)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${FG}">${d_.name ? `<strong>${escapeHtml(d_.name)}</strong> — ` : ""}${escapeHtml(d_.reason)}</td>
    </tr>`)
    .join("");

  // User's book.
  const bookTable = bookMoves.length === 0 ? "" : bookMoves
    .map((b) => {
      const tierTag = b.tier ? `<span style="display:inline-block;padding:1px 5px;border:1px solid ${BORDER};border-radius:3px;font-size:10px;color:${MUTED};margin-right:6px;">T${b.tier}</span>` : "";
      return `<tr>
        <td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:13px;color:${FG};">${tierTag}${escapeHtml(b.symbol)}</td>
        <td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;color:${MUTED};text-align:right;">${fmtLevel(b.price, "$")}</td>
        <td style="padding:5px 12px;border-bottom:1px solid ${BORDER};font-family:'Menlo','SF Mono',monospace;font-size:12px;text-align:right;">${pctSpan(b.changePct)}</td>
      </tr>`;
    })
    .join("");

  // Thesis flips today.
  const flipsList = flips.length === 0 ? "" : `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:13px;line-height:1.6;">${flips
    .map((f) => `<li><strong>${escapeHtml(f.symbol)}</strong>: ${escapeHtml(f.from)} → <span style="color:${f.to === "weakened" || f.to === "broken" ? LOSS : GAIN};">${escapeHtml(f.to)}</span></li>`)
    .join("")}</ul>`;

  // Calendar (earnings + macro for next 2 days).
  const calendarList = (upcomingEarnings.length || macroTomorrow.length) ? `<ul style="margin:8px 0;padding-left:18px;color:${FG};font-size:13px;line-height:1.6;">${[
    ...upcomingEarnings.map((e) => `<li><strong>${escapeHtml(e.symbol)}</strong> earnings on ${escapeHtml(e.date)}${e.timing ? ` <span style="color:${MUTED};">(${e.timing})</span>` : ""}</li>`),
    ...macroTomorrow.map((m) => `<li><strong>${escapeHtml(m.label)}</strong> <span style="color:${MUTED};">— ${escapeHtml(m.date)}</span></li>`),
  ].join("")}</ul>` : "";

  const frameWatchHtml = brief.frame_watch && brief.frame_watch !== "N/A"
    ? `<p style="margin:0;color:${FG};font-size:13px;line-height:1.7">${escapeHtml(brief.frame_watch)}</p>`
    : `<p style="margin:0;color:${MUTED};font-size:13px;font-style:italic">No material ${escapeHtml(frameLabel)} news today.</p>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Market brief — ${escapeHtml(dateLabel)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width:680px;margin:0 auto;background:${BG};">

    <!-- HEADER -->
    <tr><td style="padding:22px 24px 18px;background:#06121f;border-bottom:1px solid ${BORDER}">
      <div style="font-size:10px;font-weight:700;letter-spacing:2.5px;color:${ACCENT};text-transform:uppercase;margin-bottom:5px">Daily Market Brief</div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="color:${FG};font-size:19px;font-weight:700">${escapeHtml(brief.date || dateLabel)}</td>
          <td align="right"><span style="background:${tone.fg};color:#fff;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">${escapeHtml(brief.market_tone)}</span></td>
        </tr>
      </table>
    </td></tr>

    <!-- SYNOPSIS -->
    <tr><td style="padding:18px 24px;background:#0e1b2a;border-bottom:1px solid ${BORDER}">
      <div style="font-size:10px;font-weight:700;color:${MUTED};letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Synopsis</div>
      <div style="font-size:13.5px;line-height:1.75;color:${FG}">${escapeHtml(brief.synopsis)}</div>
    </td></tr>

    <!-- INDEX TABLE -->
    <tr><td style="padding:18px 24px;border-bottom:1px solid ${BORDER}">
      <div style="font-size:10px;font-weight:700;color:${MUTED};letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Index Performance</div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse">
        <tr style="background:#0e1b2a">
          <th style="text-align:left;padding:7px 12px;font-size:10px;color:${MUTED};font-weight:700">INDEX</th>
          <th style="text-align:right;padding:7px 12px;font-size:10px;color:${MUTED};font-weight:700">LEVEL</th>
          <th style="text-align:right;padding:7px 12px;font-size:10px;color:${MUTED};font-weight:700">DAY</th>
          <th style="text-align:right;padding:7px 12px;font-size:10px;color:${MUTED};font-weight:700">MTD</th>
          <th style="text-align:right;padding:7px 12px;font-size:10px;color:${MUTED};font-weight:700">YTD</th>
        </tr>
        ${indexTable}
      </table>
    </td></tr>

    <!-- MACRO TILES -->
    <tr><td style="padding:18px 24px;border-bottom:1px solid ${BORDER}">
      <div style="font-size:10px;font-weight:700;color:${MUTED};letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Macro</div>
      ${macroTilesHtml}
    </td></tr>

    <!-- SECTORS + MOVERS -->
    <tr><td style="padding:0;border-bottom:1px solid ${BORDER}">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse">
        <tr>
          <td valign="top" style="width:40%;padding:18px 12px 18px 24px;border-right:1px solid ${BORDER}">
            <div style="font-size:10px;font-weight:700;color:${MUTED};letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Sectors</div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse">${sectorTable}</table>
          </td>
          <td valign="top" style="width:60%;padding:18px 24px 18px 12px">
            ${gainerRows ? `<div style="font-size:10px;font-weight:700;color:${GAIN};letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">▲ Gainers</div>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:14px">${gainerRows}</table>` : ""}
            ${declinerRows ? `<div style="font-size:10px;font-weight:700;color:${LOSS};letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">▼ Decliners</div>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse">${declinerRows}</table>` : ""}
          </td>
        </tr>
      </table>
    </td></tr>

    ${bookMoves.length > 0 ? `<!-- USER BOOK -->
    <tr><td style="padding:18px 24px;border-bottom:1px solid ${BORDER}">
      <div style="font-size:10px;font-weight:700;color:${MUTED};letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Your book today</div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid ${BORDER};border-collapse:separate;border-radius:6px">
        <thead><tr style="background:#0e1b2a">
          <th style="text-align:left;padding:6px 12px;font-size:10px;color:${MUTED};font-weight:700">TICKER</th>
          <th style="text-align:right;padding:6px 12px;font-size:10px;color:${MUTED};font-weight:700">LAST</th>
          <th style="text-align:right;padding:6px 12px;font-size:10px;color:${MUTED};font-weight:700">DAY %</th>
        </tr></thead>
        <tbody>${bookTable}</tbody>
      </table>
    </td></tr>` : ""}

    ${flipsList ? `<!-- THESIS FLIPS -->
    <tr><td style="padding:18px 24px;border-bottom:1px solid ${BORDER}">
      <div style="font-size:10px;font-weight:700;color:${MUTED};letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Thesis flips today</div>
      ${flipsList}
    </td></tr>` : ""}

    <!-- FRAME WATCH (industry-specific) -->
    <tr><td style="padding:16px 24px;background:#1a1409;border-left:4px solid #f9a825;border-bottom:1px solid ${BORDER}">
      <div style="font-size:10px;font-weight:700;color:#f9a825;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">⚡ ${escapeHtml(frameLabel)} Watch</div>
      ${frameWatchHtml}
    </td></tr>

    <!-- CALENDAR AHEAD -->
    <tr><td style="padding:16px 24px;border-bottom:1px solid ${BORDER}">
      <div style="font-size:10px;font-weight:700;color:${MUTED};letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">📅 Calendar Ahead</div>
      ${brief.calendar_ahead ? `<p style="margin:0 0 6px;color:${FG};font-size:13px;line-height:1.7">${escapeHtml(brief.calendar_ahead)}</p>` : ""}
      ${calendarList}
    </td></tr>

    <!-- CTA -->
    <tr><td style="padding:18px 24px 24px;text-align:center;background:#0e1b2a">
      <a href="${appUrl}" style="display:inline-block;padding:10px 18px;background:${ACCENT};color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none">Open The Terminal</a>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="padding:12px 24px;background:#06121f;text-align:center;border-top:1px solid ${BORDER}">
      <div style="font-size:11px;color:${MUTED}">Powered by DeepSeek + Tavily · Auto-generated weekdays 5:30pm ET · <em>Not financial advice</em></div>
    </td></tr>

  </table>
</body></html>`;
}

export function buildDailyEmailText(d: DailyEmailData): string {
  const lines: string[] = [];
  const fmt = (n: number | null | undefined) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
  lines.push(`THE TERMINAL — Daily Market Brief`);
  lines.push(`${d.dateLabel} · ${d.brief.market_tone.toUpperCase()}`);
  lines.push("");
  lines.push("SYNOPSIS");
  lines.push(d.brief.synopsis);
  lines.push("");

  lines.push("INDEX PERFORMANCE");
  for (const r of d.indexRows) {
    lines.push(`  ${r.name}: ${r.level != null ? "$" + r.level.toFixed(2) : "—"} | day ${fmt(r.dayChgPct)} | MTD ${fmt(r.mtdPct)} | YTD ${fmt(r.ytdPct)}`);
  }
  lines.push("");

  lines.push("MACRO");
  for (const t of d.macroTiles) {
    const val = t.value == null ? "—" : t.isYield ? `${t.value.toFixed(2)}%` : t.value.toFixed(2);
    lines.push(`  ${t.label}: ${val} (${fmt(t.changePct)})`);
  }
  lines.push("");

  lines.push("SECTORS");
  for (const s of d.sectorRows) lines.push(`  ${s.name} (${s.symbol}): ${fmt(s.changePct)}`);
  lines.push("");

  if (d.brief.notable_gainers.length) {
    lines.push("GAINERS");
    for (const g of d.brief.notable_gainers) lines.push(`  ${g.ticker} ${g.pct} — ${g.name}: ${g.reason}`);
    lines.push("");
  }

  if (d.brief.notable_decliners.length) {
    lines.push("DECLINERS");
    for (const x of d.brief.notable_decliners) lines.push(`  ${x.ticker} ${x.pct} — ${x.name}: ${x.reason}`);
    lines.push("");
  }

  if (d.bookMoves.length) {
    lines.push("YOUR BOOK TODAY");
    for (const b of d.bookMoves) {
      lines.push(`  ${b.tier ? `T${b.tier} ` : ""}${b.symbol}: $${b.price?.toFixed(2) ?? "?"} ${fmt(b.changePct)}`);
    }
    lines.push("");
  }

  if (d.flips.length) {
    lines.push("THESIS FLIPS TODAY");
    for (const f of d.flips) lines.push(`  ${f.symbol}: ${f.from} → ${f.to}`);
    lines.push("");
  }

  lines.push(`${d.frameLabel.toUpperCase()} WATCH`);
  lines.push(d.brief.frame_watch || "N/A");
  lines.push("");

  lines.push("CALENDAR AHEAD");
  if (d.brief.calendar_ahead) lines.push(d.brief.calendar_ahead);
  for (const e of d.upcomingEarnings) lines.push(`  ${e.symbol} earnings on ${e.date}${e.timing ? ` (${e.timing})` : ""}`);
  for (const m of d.macroTomorrow) lines.push(`  ${m.label} — ${m.date}`);
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
