import { Fragment, type ReactNode } from "react";

/**
 * Renders an assistant reply with light markdown formatting.
 *
 * Models emit markdown (headings, **bold**, lists, `code`), and the chat used
 * to print it raw — so users saw literal asterisks and hashes instead of
 * structure.
 *
 * Everything is built as React elements. There is no `dangerouslySetInnerHTML`
 * anywhere here: model output is untrusted text and must never be able to
 * inject markup.
 */

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang?: string; lines: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

/** Splits a markdown table row into trimmed cells. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** True for the `|---|---|` separator under a table header. */
function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

/** Splits raw reply text into structural blocks. */
function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "p", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block — consume until the closing fence.
    const fence = line.match(/^\s*```\s*(\w+)?\s*$/);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code", lang: fence[1], lines: body });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    // Markdown table: a header row, a divider, then body rows.
    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushParagraph();
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i++;
      }
      i--; // The outer loop advances again.
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const heading = line.match(/^\s*(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "h",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: "quote", text: quote[1].trim() });
      continue;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(bullet[1].trim());
      else blocks.push({ kind: "ul", items: [bullet[1].trim()] });
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ol") last.items.push(numbered[1].trim());
      else blocks.push({ kind: "ol", items: [numbered[1].trim()] });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

/** Applies inline markers (**bold**, *italic*, `code`) within a line. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass over the three inline forms, longest marker first.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${n++}`;
    if (token.startsWith("**")) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function FormattedReply({ text }: { text: string }) {
  const blocks = parseBlocks(text);

  // Nothing structural — render as a plain paragraph so short replies stay
  // visually identical to before.
  if (blocks.length === 1 && blocks[0].kind === "p") {
    return <>{renderInline(blocks[0].text, "b0")}</>;
  }

  return (
    <div className="reply-body">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "h": {
            const Tag = (`h${block.level + 3}`) as "h4" | "h5" | "h6";
            return (
              <Tag key={key} className="reply-heading">
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case "ul":
            return (
              <ul key={key} className="reply-list">
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="reply-list">
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={key} className="reply-code">
                <code>{block.lines.join("\n")}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={key} className="reply-quote">
                {renderInline(block.text, key)}
              </blockquote>
            );
          case "table":
            return (
              // Wrapper scrolls so a wide table never widens the bubble.
              <div key={key} className="reply-table-wrap">
                <table className="reply-table">
                  <thead>
                    <tr>
                      {block.head.map((h, i) => (
                        <th key={`${key}-h${i}`}>{renderInline(h, `${key}-h${i}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`${key}-r${r}`}>
                        {row.map((cell, c) => (
                          <td key={`${key}-r${r}c${c}`}>
                            {renderInline(cell, `${key}-r${r}c${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={key} className="reply-paragraph">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

export { parseBlocks as __parseBlocksForTests };
export type { Block as __Block };

/** Convenience for tests / non-JSX contexts. */
export const Formatted = Fragment;
