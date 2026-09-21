/**
 * Developer-only provenance for one assistant answer.
 *
 * Answers the question you cannot answer by reading a reply: did the model
 * write this sentence from the verified tool result, or did a template? Those
 * two look identical on screen, and for a long time the second was happening on
 * every successful action while everyone assumed the first.
 *
 * Gated on `import.meta.env.DEV`, so this is not hidden from users in a release
 * build — it is absent from it. The bundler removes the whole branch.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ResponseProvenance } from "../../features/capabilities/executionTrace";

export function ResponseDiagnostics({
  provenance,
}: {
  provenance?: ResponseProvenance;
}) {
  const [open, setOpen] = useState(false);
  if (!import.meta.env.DEV || !provenance) return null;

  const rows: Array<[string, string]> = [
    ["Tool selection", "MODEL"],
    ["Capability", provenance.capabilityId],
    ["Tool execution", provenance.toolExecutions > 0 ? "SUCCEEDED" : "NONE"],
    ["Final response", provenance.source],
    ["Provider calls", String(provenance.providerCalls)],
    ["Tool executions", String(provenance.toolExecutions)],
  ];
  if (provenance.fallbackReason) rows.push(["Fallback reason", provenance.fallbackReason]);

  return (
    <div className={`response-diagnostics${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="response-diagnostics-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight size={11} className="response-diagnostics-chevron" aria-hidden="true" />
        <span>dev · {provenance.source}</span>
      </button>
      {open ? (
        <dl className="response-diagnostics-body">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
