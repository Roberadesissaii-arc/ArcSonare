/**
 * Browser mode context: last page + helpers for URL extract / image intent /
 * redacting real URLs from model prompts (local fetch still uses the real URL).
 */

let lastUrl: string | null = null;
let lastTitle: string | null = null;
let lastImages: string[] = [];
let lastAt = 0;
const TTL_MS = 45 * 60 * 1000;

export function rememberBrowserPage(
  url: string,
  title?: string | null,
  images?: string[] | null,
): void {
  const u = url.trim();
  if (!u) return;
  lastUrl = u;
  lastTitle = title?.trim() || lastTitle;
  if (images?.length) lastImages = [...images];
  lastAt = Date.now();
}

export function getLastBrowserPage(): {
  url: string;
  title: string | null;
  images: string[];
} | null {
  if (!lastUrl) return null;
  if (Date.now() - lastAt > TTL_MS) {
    lastUrl = null;
    lastTitle = null;
    lastImages = [];
    return null;
  }
  return { url: lastUrl, title: lastTitle, images: lastImages };
}

export function clearBrowserContext(): void {
  lastUrl = null;
  lastTitle = null;
  lastImages = [];
  lastAt = 0;
}

/** First http(s) URL in free text, trailing punctuation stripped. */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:!?)]+$/, "");
}

/** User wants preview / thumbnail / picture from the link. */
export function isShowImageRequest(text: string): boolean {
  const q = text.toLowerCase();
  return (
    /\b(show|display|get|extract|find|grab|pull|give|download|save)\b.{0,48}\b(image|images|img|thumbnail|thumb|picture|pic|preview|poster|cover)\b/.test(
      q,
    ) ||
    /\b(image|thumbnail|thumb|picture|pic|preview)\b.{0,20}\b(of|for|from)\b/.test(q) ||
    /^(?:the\s+)?(?:thumbnail|image|picture|preview)\s*(?:please)?$/.test(q.trim()) ||
    /\bshow\s+me\s+(?:the\s+)?(?:image|images|thumbnail|picture|pic|preview)\b/.test(q) ||
    /\b(show|see|open)\s+(?:me\s+)?(?:the\s+)?(?:image|images|thumbnail|picture|pic)\b/.test(q) ||
    (/\b(image|images|thumbnail|thumb|picture|pic|preview)\b/.test(q) &&
      /https?:\/\//i.test(text))
  );
}

/** Neutral token for model-facing text. Local HTTP still uses the real user URL. */
export const MODEL_LINK_TOKEN = "[linked-page]";

/**
 * Strip real URLs from text before sending to a cloud model.
 * Local fetch still uses the real URL.
 */
export function redactUrlsForModel(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, MODEL_LINK_TOKEN)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prepare user text for a cloud model: replace URLs with a neutral token.
 */
export function wrapSensitiveForModel(text: string): string {
  if (!text?.trim()) return text;
  return redactUrlsForModel(text);
}

/**
 * Sanitize tool facts before a cloud model styles them.
 */
export function wrapFactsForModel(facts: string, _pageUrl?: string | null): string {
  return (facts ?? "")
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, MODEL_LINK_TOKEN)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Score candidate image URLs — higher = more likely a real preview, not junk. */
function imageQualityScore(url: string): number {
  const u = url.toLowerCase();
  if (
    /favicon|sprite|1x1|pixel|tracking|badge|emoji|avatar.?small|logo|icon[_/-]|banner|\/ads?[./]|adservice|doubleclick|analytics|promo|sponsor/i.test(
      u,
    )
  ) {
    return -100;
  }
  if (/youtube\.com\/\d+$/i.test(u) || /\/\d{2,4}$/.test(u)) return -100;

  let score = 0;
  if (/ytimg\.com|ggpht\.com/.test(u)) score += 50;
  if (/\/vi\/[a-z0-9_-]{11}\//i.test(u)) score += 40;
  if (/maxresdefault|sddefault|hqdefault/.test(u)) score += 20;
  if (/\.(jpe?g|webp)(\?|$)/i.test(u)) score += 15;
  if (/\.(png|gif|avif)(\?|$)/i.test(u)) score += 8;
  if (/\b(1280|1920|720|640|original|large|full)\b/i.test(u)) score += 10;
  if (/\b(thumb|small|mini|tiny|48x|32x|16x)\b/i.test(u)) score -= 25;
  if (/cloudfront|fbcdn|cdninstagram|imgur|twimg|googleusercontent/.test(u)) score += 5;
  if (url.length > 280) score -= 10;
  return score;
}

/**
 * Prefer real preview images only. Rejects logos/ads/pixels.
 */
export function pickDisplayImages(images: string[] | undefined | null, max = 3): string[] {
  if (!images?.length) return [];
  const ranked = images
    .filter((img) => typeof img === "string" && /^https?:\/\//i.test(img))
    .map((img, i) => ({ img, i, score: imageQualityScore(img) }))
    .filter((x) => x.score >= 8)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const out: string[] = [];
  for (const { img } of ranked) {
    if (out.includes(img)) continue;
    out.push(img);
    if (out.length >= max) break;
  }
  return out;
}

/** Detect generic model refusal so we can fall back to local tool results. */
export function isModelRefusal(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /\bi can'?t help\b/i.test(t) ||
    /\bi cannot help\b/i.test(t) ||
    /\bi'?m (not|unable) (able )?to (help|assist|open|display|show)\b/i.test(t) ||
    /\bcan'?t (open|display|show|access|fetch)\b/i.test(t) ||
    /\bagainst (my|the) (guidelines|policies|rules)\b/i.test(t) ||
    /\bnot appropriate\b/i.test(t) ||
    /\bi (won'?t|will not) (open|display|fetch|visit)\b/i.test(t)
  );
}

/**
 * Build a user-facing reply from real tool data only (no invented images/sites).
 */
export function localBrowserReply(input: {
  userRequest: string;
  title?: string | null;
  textSnippet?: string | null;
  imageCount: number;
  textChars?: number;
  failed?: boolean;
  errorSummary?: string;
}): string {
  if (input.failed) {
    const err = (input.errorSummary || "Could not fetch that link.").trim();
    if (isModelRefusal(err)) {
      return "I couldn't pull content from that link.";
    }
    return err;
  }

  const title = cleanTitle(input.title);
  const snippet = cleanSnippet(input.textSnippet, 320);
  const wantImage = isShowImageRequest(input.userRequest);

  if (wantImage) {
    if (input.imageCount <= 0) {
      return title
        ? `I opened “${title}” but no preview image was found on the page.`
        : "No preview image was found on that page.";
    }
    if (title) {
      return input.imageCount === 1
        ? `Here’s the preview from “${title}”.`
        : `Here are ${input.imageCount} previews from “${title}”.`;
    }
    return input.imageCount === 1
      ? "Here’s the preview from that page."
      : `Here are ${input.imageCount} previews from that page.`;
  }

  const parts: string[] = [];
  if (title) parts.push(`**${title}**`);
  if (snippet) parts.push(snippet);
  if (!snippet && input.imageCount > 0) {
    parts.push(
      input.imageCount === 1
        ? "A preview image is shown below."
        : `${input.imageCount} preview images are shown below.`,
    );
  }
  if (parts.length === 0) {
    return "I fetched that page, but there wasn’t much readable text to show.";
  }
  return parts.join("\n\n");
}

function cleanTitle(raw?: string | null): string {
  if (!raw?.trim()) return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 120);
}

function cleanSnippet(raw?: string | null, max = 320): string {
  if (!raw?.trim()) return "";
  let s = raw
    .replace(/\s+/g, " ")
    .replace(/cookie|accept all/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 80 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** Build model-facing facts from a real fetch — no inventing images or URLs. */
export function pageFactsForModel(input: {
  title?: string | null;
  text?: string | null;
  imageCount: number;
}): string {
  const title = cleanTitle(input.title) || "(none)";
  const snippet = cleanSnippet(input.text, 600);
  return [
    `Page title: ${title}`,
    `Preview images available in UI: ${input.imageCount}`,
    input.imageCount > 0
      ? "Images are already shown under the reply. Do not invent what they depict. Do not invent URLs."
      : "No preview images were extracted.",
    snippet
      ? `Extracted text (ground truth):\n${snippet}`
      : "No readable text was extracted.",
    "Reply naturally from these facts only. Do not invent a different website.",
  ].join("\n\n");
}
