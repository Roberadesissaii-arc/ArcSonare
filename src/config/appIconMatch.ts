/**
 * Name → icon matching for the bundled application icon library.
 *
 * Separate from `appIconLibrary` so it can be tested against the real ~870
 * filenames: that module's only job is handing this one the glob result, and a
 * matcher that is only exercised through a bundler is a matcher nobody checks.
 */

/**
 * Vendor words worth indexing without.
 *
 * People say "After Effects", not "Adobe After Effects"; "Chrome", not "Google
 * Chrome". The stripped form is only kept when it stays unambiguous — dropping
 * the vendor from two different files would let one silently win.
 */
const VENDOR_PREFIXES = [
  "adobe",
  "microsoft",
  "google",
  "apple",
  "autodesk",
  "affinity",
  "jetbrains",
  "corel",
  "wondershare",
];

export function normalizeIconName(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.ico$/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface AppIconIndex {
  lookup(query: string): string | null;
  size: number;
}

/** Build the index from `{ "Adobe After Effects.ico": url }`. */
export function buildAppIconIndex(files: Record<string, string>): AppIconIndex {
  const byName = new Map<string, string>();
  const byAlias = new Map<string, string>();
  const aliasCounts = new Map<string, number>();
  const entries: Array<{ tokens: string[]; url: string }> = [];

  for (const [file, url] of Object.entries(files)) {
    const name = normalizeIconName(file.split("/").pop() ?? file);
    if (!name || !url) continue;
    byName.set(name, url);
    entries.push({ tokens: name.split(" ").filter(Boolean), url });

    const first = name.split(" ")[0];
    if (VENDOR_PREFIXES.includes(first)) {
      const stripped = name.slice(first.length).trim();
      if (stripped) {
        aliasCounts.set(stripped, (aliasCounts.get(stripped) ?? 0) + 1);
        byAlias.set(stripped, url);
      }
    }
  }
  for (const [alias, count] of aliasCounts) {
    if (count > 1) byAlias.delete(alias);
  }

  return {
    size: byName.size,
    /**
     * Three passes, narrowing only: exact name, unambiguous vendor-stripped
     * alias, then whole-word containment with a single winner. Ambiguity
     * returns null rather than a guess — the wrong app's logo beside a result
     * is a small lie about what happened.
     */
    lookup(query: string): string | null {
      const q = normalizeIconName(query)
        .replace(/^(?:the|my|open|launch)\s+/, "")
        .replace(/\s+(?:app|application)$/, "")
        .trim();
      // Two characters is not an app name; it is a fragment matching anything.
      if (q.length < 3) return null;

      const exact = byName.get(q) ?? byAlias.get(q);
      if (exact) return exact;

      const queryTokens = q.split(" ").filter((t) => t.length > 1);
      if (queryTokens.length === 0) return null;

      const hits = entries.filter((entry) =>
        queryTokens.every((token) => entry.tokens.includes(token)),
      );
      if (hits.length === 0) return null;
      if (hits.length === 1) return hits[0].url;

      // Several matched — prefer the most specific single name ("Premiere Pro"
      // over "Adobe Premiere Pro"), and only when nothing ties with it.
      const shortest = hits.reduce((a, b) =>
        a.tokens.length <= b.tokens.length ? a : b,
      );
      const tied = hits.filter((h) => h.tokens.length === shortest.tokens.length);
      return tied.length === 1 ? shortest.url : null;
    },
  };
}
