/**
 * The Realtime tool list is what the model sees. If a schema is malformed or a
 * name is unroundtrippable, the model silently calls the wrong thing.
 *
 * Run: npx tsx scripts/check-realtime-tools.mts
 */

import { buildRealtimeTools } from "../src/services/realtime/realtimeToolSchemas";
import {
  fromToolName,
  toToolName,
} from "../src/features/capabilities/providerToolAdapter";
import { getCapability } from "../src/features/capabilities/capabilityRegistry";

const tools = buildRealtimeTools();
let failed = 0;
const fail = (msg: string) => {
  failed++;
  console.log(`FAIL  ${msg}`);
};

console.log(`Realtime exposes ${tools.length} tools`);
console.log("=".repeat(90));

if (tools.length === 0) fail("no tools exposed — the model would have nothing to call");

const names = new Set<string>();
for (const tool of tools) {
  if (tool.type !== "function") fail(`${tool.name}: type must be "function"`);
  if (!/^[a-zA-Z0-9_-]+$/.test(tool.name)) {
    fail(`${tool.name}: name has characters OpenAI rejects`);
  }
  if (names.has(tool.name)) fail(`${tool.name}: duplicate tool name`);
  names.add(tool.name);

  if (!tool.description?.trim()) fail(`${tool.name}: empty description`);

  // Must round-trip back to a real capability, or dispatch cannot find it.
  const id = fromToolName(tool.name);
  if (!getCapability(id)) fail(`${tool.name}: does not map back to a capability`);
  if (toToolName(id) !== tool.name) fail(`${tool.name}: name does not round-trip`);

  const params = tool.parameters as { type?: string } | undefined;
  if (!params || params.type !== "object") {
    fail(`${tool.name}: parameters must be a JSON Schema object`);
  }
}

const sample = tools.slice(0, 8).map((t) => t.name);
console.log("sample:", sample.join(", "));
console.log("-".repeat(90));
console.log(failed ? `${failed} FAILED` : `all ${tools.length} tool schemas valid`);

// ── Every character must map to a voice the Realtime API accepts ──────────
const { VOICE_CHARACTERS } = await import("../src/features/voice-settings/voiceCharacters");
const { REALTIME_VOICES } = await import("../src/services/realtime/realtimeToolSchemas");

console.log("");
for (const c of VOICE_CHARACTERS) {
  const ok = REALTIME_VOICES.has(c.preferredProviderVoiceId);
  if (!ok) fail(`character "${c.id}" uses voice "${c.preferredProviderVoiceId}" — not a Realtime voice`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.displayName.padEnd(8)} -> ${c.preferredProviderVoiceId}`);
}
console.log("-".repeat(90));
console.log(failed ? `${failed} FAILED` : "all tool schemas and voices valid");
process.exit(failed ? 1 : 0);
