/** Every capability the router can emit must have a human label + agent. */
import { agentForTool, labelForTool } from "../src/components/chat/toolLabels";
import { routeDeterministic } from "../src/features/capabilities/capabilityRouter";
import { classifyIntent } from "../src/features/orchestration/IntentClassifier";

const utterances = [
  "create a task to renew my passport","mark the passport task done","list my tasks",
  "what's on my desktop","create a folder called Reports on my desktop","find my budget file",
  "open spotify","close spotify","what time is it","take a screenshot",
  "what's on my clipboard","google rust ownership","go to settings",
  "what's in my gmail","open gmail","is my gmail connected",
  "what's on my calendar today","add a dentist appointment tomorrow at 2pm to my calendar",
  "what's in my google drive","what's the weather",
];
const ids = new Set<string>();
for (const u of utterances) {
  const d = routeDeterministic(u);
  if (d) ids.add(d.capabilityId);
  const c = classifyIntent(u).capabilityId;
  if (c) ids.add(c);
}
let fail = 0;
for (const id of [...ids].sort()) {
  const label = labelForTool(id);
  const agent = agentForTool(id);
  // A label is "unmapped" if it just de-slugged the id (contains no space and matches the suffix)
  const mapped = label && label.toLowerCase() !== id.split(".").slice(1).join(" ").replace(/_/g," ");
  const genericAgent = agent === "Assistant";
  const ok = Boolean(label) && !genericAgent;
  if (!ok) fail++;
  console.log(`${ok?"PASS":"FAIL"}  ${id.padEnd(36)} agent=${agent.padEnd(12)} label=${label}${mapped?"":"  (de-slugged fallback)"}`);
}
console.log(`\n${ids.size - fail}/${ids.size} capabilities have an agent + label`);
process.exit(fail?1:0);
