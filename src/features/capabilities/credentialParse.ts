/**
 * Reading a stored credential without ever being able to disclose it.
 *
 * This exists because the obvious implementation leaks. `JSON.parse` embeds its
 * input in the exception it throws — `SyntaxError: Unexpected token 'A',
 * "AIza…" is not valid JSON` — so a malformed credential blob turns into a
 * secret inside an error message, which then travels wherever errors travel:
 * a console, a log file, an audit report, a bug tracker. The same class of bug
 * printed a real key to a terminal during this work.
 *
 * The rules here are absolute, not best-effort:
 *
 *   - a parse failure never propagates the parser's message
 *   - a parse failure never returns the raw blob as a value
 *   - nothing in this module's output can contain a credential
 *   - `toString`/`JSON.stringify` of any result is safe to log
 *
 * Callers get a value or nothing. They never get a reason that quotes the input.
 */

/** What a credential is, with no hint of what it says. */
export type CredentialShape =
  | "json-object"
  | "opaque-string"
  | "empty"
  | "unreadable";

export interface CredentialReadResult {
  shape: CredentialShape;
  /** Field names only. Names are structure; values are the secret. */
  fields: string[];
  /** True when at least one requested field held a non-empty value. */
  hasValue: boolean;
}

/**
 * A parsed credential whose values can be used but not printed.
 *
 * The value is held in a closure rather than a property, so it cannot be
 * reached by `JSON.stringify`, a spread, a debugger's object dump, or a
 * well-meaning `console.log(credential)`.
 */
export interface SecretHandle {
  /** Structure only — safe to log. */
  describe(): CredentialReadResult;
  /** The one way to reach a value. Callers must not log what they get. */
  reveal(field: string): string | null;
  /** Guarantees a stringified handle can never carry the secret. */
  toString(): string;
  toJSON(): CredentialReadResult;
}

function safeParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    // Deliberately swallowed and never inspected. The parser's message
    // contains the input; touching it at all is the leak.
    return null;
  }
}

/**
 * Turn a stored blob into a handle.
 *
 * A blob that is not a JSON object is treated as one opaque value rather than
 * being discarded — some older entries were saved bare — but it is still never
 * echoed, and it is still only reachable through `reveal`.
 */
export function readCredentialBlob(raw: string | null | undefined): SecretHandle {
  const text = typeof raw === "string" ? raw.replace(/\0/g, "").trim() : "";

  if (!text) {
    const empty: CredentialReadResult = { shape: "empty", fields: [], hasValue: false };
    return {
      describe: () => empty,
      reveal: () => null,
      toString: () => "[credential: empty]",
      toJSON: () => empty,
    };
  }

  const parsed = safeParseObject(text);
  const values = new Map<string, string>();

  if (parsed) {
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) values.set(key, value.trim());
    }
  }

  // A blob that is not a JSON object yields NO value.
  //
  // The first version fell back to handing the raw text back as the credential.
  // That is how a truncated `{"apiKey": "AIza…` — a blob, not a key — would end
  // up interpolated into a request URL, and from there into a log line. If the
  // stored record cannot be read as the structure it is supposed to be, the
  // honest answer is that there is no credential, and the user reconnects.
  const result: CredentialReadResult = {
    shape: parsed ? "json-object" : "unreadable",
    fields: parsed ? Object.keys(parsed) : [],
    hasValue: values.size > 0,
  };

  return {
    describe: () => result,
    reveal: (field: string) => values.get(field) ?? null,
    toString: () => `[credential: ${result.shape}, ${result.fields.length} field(s)]`,
    toJSON: () => result,
  };
}

/**
 * Last line of defence before text leaves the process.
 *
 * Anything shaped like a key is removed rather than trusted not to be there.
 * This is not a substitute for not putting secrets in strings — it is what
 * catches the path nobody thought about.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-api-key]")
    .replace(/ya29\.[0-9A-Za-z._-]+/g, "[redacted-oauth-token]")
    .replace(/\b1\/\/[0-9A-Za-z._-]{20,}/g, "[redacted-refresh-token]")
    .replace(/\bsk-[0-9A-Za-z]{16,}/g, "[redacted-secret-key]")
    .replace(/\bghp_[0-9A-Za-z]{20,}/g, "[redacted-token]")
    .replace(/\bxox[baprs]-[0-9A-Za-z-]{10,}/g, "[redacted-token]")
    .replace(/([?&](?:key|api_key|access_token|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(authorization\s*:\s*)(bearer\s+)?\S+/gi, "$1[redacted]");
}
