// Pull the full text of a transcript page or PDF. Strategy:
//   1. If the URL is a PDF (by extension or content-type), fetch the bytes and
//      run them through unpdf — many IR pages publish transcripts as PDFs.
//   2. Otherwise try Tavily extract (advanced) — handles most HTML pages cleanly.
//   3. If Tavily fails, fall back to direct fetch + naive HTML→text strip.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";
import { createServerSupabase } from "@/lib/supabase/server";
import { tavilyExtract } from "@/lib/providers/tavily";
import { scrapeWithRetry } from "@/lib/providers/scraping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BodySchema = z.object({
  url: z.string().url(),
});

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { url } = parsed.data;
  const tried: string[] = [];

  // 0. PDF detection — by extension first (cheap), then by HEAD content-type.
  const looksLikePdfByUrl = /\.pdf(?:[?#]|$)/i.test(url);
  let looksLikePdfByHead = false;
  if (!looksLikePdfByUrl) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        headers: { "user-agent": UA },
        // Many CDNs block HEAD; we just treat failure as "not a PDF" and continue.
        signal: AbortSignal.timeout(5000),
      });
      const ct = head.headers.get("content-type") ?? "";
      looksLikePdfByHead = ct.toLowerCase().includes("application/pdf");
    } catch {
      // ignore — fall through to HTML path
    }
  }

  if (looksLikePdfByUrl || looksLikePdfByHead) {
    tried.push("pdf-fetch");
    try {
      const pdfRes = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/pdf,*/*" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`);
      const bytes = new Uint8Array(await pdfRes.arrayBuffer());
      const doc = await getDocumentProxy(bytes);
      const { text } = await extractText(doc, { mergePages: true });
      const joined = typeof text === "string" ? text : Array.isArray(text) ? (text as string[]).join("\n") : "";
      const clean = normalizePdfText(joined);
      if (clean.length < 500) {
        return NextResponse.json(
          { error: `Extracted only ${clean.length} chars from PDF. Might be a scanned/image PDF (needs OCR). Paste the transcript text manually.` },
          { status: 422 },
        );
      }
      return NextResponse.json({ url, text: clean, length: clean.length, source: "pdf" });
    } catch (err) {
      console.warn("PDF extraction failed, falling back to Tavily/HTML", err);
      // fall through
    }
  }

  // 1. Tavily extract (advanced).
  try {
    tried.push("tavily-advanced");
    const result = await tavilyExtract(url, { depth: "advanced" });
    if (result.rawContent && result.rawContent.length > 500) {
      return NextResponse.json({
        url: result.url,
        text: result.rawContent,
        length: result.rawContent.length,
        source: "tavily",
      });
    }
  } catch (err) {
    console.warn("Tavily extract failed, falling back to direct fetch", err);
  }

  // 2. Direct fetch + HTML→text fallback.
  try {
    tried.push("direct-fetch");
    const html = await scrapeWithRetry(url, { source: "transcript-fallback", attempts: 2, timeoutMs: 15000 });
    const text = htmlToText(html);
    if (text.length < 500) {
      return NextResponse.json(
        {
          error: `Extracted too little text (${text.length} chars). The page may be paywalled or rendered client-side. Try a different source (Motley Fool transcripts at fool.com tend to work best), or paste the transcript manually.`,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({
      url,
      text,
      length: text.length,
      source: "direct",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Couldn't extract this page (tried: ${tried.join(", ")}). The site likely has anti-scraper protection or requires login. Try a Motley Fool URL instead, or paste manually. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function normalizePdfText(s: string): string {
  return s
    // Collapse the funky hyphenated word breaks PDFs often have
    .replace(/-\n/g, "")
    // Strip page headers/footers that show as runs of dashes / dots
    .replace(/^[\s\-\.]{3,}$/gm, "")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Strip HTML to plain text. Good enough for transcript pages — the model can
// deal with noisy whitespace, and we just want the call body.
function htmlToText(html: string): string {
  return html
    // Drop script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    // Drop navigation chrome — best-effort by class/role hints
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    // Convert <br> and </p> to newlines so the transcript stays readable
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
