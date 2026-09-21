/**
 * Thin wrapper — all presentation goes through styleAssistantOutput.
 * Kept so existing imports keep working.
 */

import {
  styleAssistantOutput,
  structureAsMarkdown,
  parseEmailDump,
  detectOutputShape,
  shouldStyleAsToolOutput,
  type ParsedEmail,
} from "../../services/styleAssistantOutput";

export {
  parseEmailDump,
  structureAsMarkdown as formatVerifiedPayload,
  detectOutputShape,
  shouldStyleAsToolOutput,
  type ParsedEmail,
};

export function shouldPresentAsData(
  capabilityId: string | undefined,
  verified: string,
): boolean {
  return shouldStyleAsToolOutput(capabilityId, verified);
}

export async function presentVerifiedData(
  verified: string,
  userRequest: string,
  capabilityId?: string,
): Promise<{ text: string; usedModel: boolean; sourceHint: string }> {
  const result = await styleAssistantOutput({
    facts: verified,
    userRequest,
    capabilityId,
    shape: "auto",
    useModel: true,
    sourceHint: capabilityId?.startsWith("email.")
      ? "Gmail"
      : capabilityId?.includes("calendar")
        ? "Calendar"
        : capabilityId?.includes("drive")
          ? "Drive"
          : "ArcSonare",
  });
  return {
    text: result.text,
    usedModel: result.usedModel,
    sourceHint: result.sourceHint,
  };
}
