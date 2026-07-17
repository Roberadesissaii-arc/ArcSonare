/**
 * Safe orchestration audit — no message bodies, no secrets.
 */

import type { ConnectionStatus, IntentContract, IntentMode } from "./IntentContract";

export type IntentAuditRecord = {
  id: string;
  userRequestSummary: string;
  intentMode: IntentMode;
  domain: string;
  selectedCapabilityId?: string;
  connectionAccountId?: string;
  connectionStatus?: ConnectionStatus | string;
  correctionApplied?: {
    proposedTool: string;
    correctedTool: string;
    reason: string;
  };
  resultStatus:
    | "success"
    | "partial"
    | "disconnected"
    | "authentication-required"
    | "missing-scope"
    | "failed"
    | "navigated"
    | "opened";
  providerId?: string;
  modelId?: string;
  createdAt: string;
  durationMs: number;
};

const MAX = 80;
const records: IntentAuditRecord[] = [];

function summarizeRequest(utterance: string): string {
  const t = utterance.trim().replace(/\s+/g, " ");
  if (t.length <= 80) return t;
  return `${t.slice(0, 77)}...`;
}

export function recordAudit(
  partial: Omit<IntentAuditRecord, "id" | "createdAt" | "userRequestSummary"> & {
    utterance: string;
  },
): IntentAuditRecord {
  const record: IntentAuditRecord = {
    id: `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    userRequestSummary: summarizeRequest(partial.utterance),
    intentMode: partial.intentMode,
    domain: partial.domain,
    selectedCapabilityId: partial.selectedCapabilityId,
    connectionAccountId: partial.connectionAccountId,
    connectionStatus: partial.connectionStatus,
    correctionApplied: partial.correctionApplied,
    resultStatus: partial.resultStatus,
    providerId: partial.providerId,
    modelId: partial.modelId,
    createdAt: new Date().toISOString(),
    durationMs: partial.durationMs,
  };
  records.unshift(record);
  if (records.length > MAX) records.length = MAX;
  return record;
}

export function listAuditRecords(): IntentAuditRecord[] {
  return records.slice();
}

export function clearAuditRecords(): void {
  records.length = 0;
}

export function auditFromContract(
  contract: IntentContract,
  rest: Omit<
    Parameters<typeof recordAudit>[0],
    "utterance" | "intentMode" | "domain"
  >,
): IntentAuditRecord {
  return recordAudit({
    utterance: contract.utterance,
    intentMode: contract.mode,
    domain: contract.domain,
    ...rest,
  });
}
