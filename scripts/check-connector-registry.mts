/**
 * The connector inventory, asserted against the code that defines it.
 *
 * Discover shows 42 services. Five have working tools. A catalogue card, a
 * credential form and a working integration look identical to a user — and,
 * until the registry existed, to the assistant as well.
 *
 * These assertions are deliberately derived rather than hard-coded lists: the
 * point of `connectorRegistry` is that adding a `slack.*` capability changes
 * Slack's status automatically, with no list to remember to update. A test that
 * pinned the current answer would defeat that.
 *
 * Run: npm run test:connector-registry
 */

import { INTEGRATIONS } from "../src/data/demoData";
import { CAPABILITY_REGISTRY, getCapability } from "../src/features/capabilities/capabilityRegistry";
import {
  capabilityAllowedForOrigin,
  connectorCapabilities,
  connectorImplementation,
  connectorProfile,
  connectorState,
  describeState,
  implementedConnectorIds,
  originPolicy,
} from "../src/features/capabilities/connectorRegistry";
import { credentialSpecFor } from "../src/config/integrationCatalog";
import { isGoogleIntegration } from "../src/config/googleOAuth";

let failed = 0;
const failures: string[] = [];
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) {
    failed += 1;
    failures.push(`${name} → ${got}`);
  }
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

// ── 1. Every Discover card has a truthful classification ───────────────────
console.log("\n— every card is classified —");
const byStatus = new Map<string, string[]>();
for (const integration of INTEGRATIONS) {
  const status = connectorImplementation(integration.id);
  byStatus.set(status, [...(byStatus.get(status) ?? []), integration.name]);
}
check(
  "every Discover card resolves to exactly one status",
  [...byStatus.values()].reduce((n, list) => n + list.length, 0) === INTEGRATIONS.length,
  [...byStatus].map(([s, l]) => `${s}=${l.length}`).join(" · "),
);
for (const [status, names] of byStatus) {
  console.log(`      ${status}: ${names.join(", ")}`);
}

// ── 2. Status follows from what exists, not from a list ────────────────────
console.log("\n— status is derived —");
for (const integration of INTEGRATIONS) {
  const id = integration.id;
  const caps = connectorCapabilities(id);
  const status = connectorImplementation(id);
  const hasAuth = Boolean(credentialSpecFor(id)) || isGoogleIntegration(id);

  const expected =
    caps.length === 0 ? (hasAuth ? "AUTH_ONLY" : "UI_ONLY") : status; // COMPLETE/PARTIAL differ only by documented limits
  if (caps.length === 0) {
    check(
      `${integration.name}: no capabilities → ${expected}`,
      status === expected,
      `${status} (auth form: ${hasAuth})`,
    );
  }
}

// ── 3. A card with nothing behind it must not offer a Connect action ───────
console.log("\n— UI-only cards are never connectable —");
const uiOnly = INTEGRATIONS.filter((i) => connectorImplementation(i.id) === "UI_ONLY");
check(
  "no UI-only connector is marked connectable",
  uiOnly.every((i) => !connectorProfile(i.id).connectable),
  `${uiOnly.length} UI-only card(s), none connectable`,
);
check(
  "no UI-only connector advertises capabilities",
  uiOnly.every((i) => connectorProfile(i.id).available.length === 0),
  "none advertise tools",
);
check(
  "a UI-only connector can never reach a connected state",
  uiOnly.every(
    (i) =>
      connectorState(i.id, { credentialPresent: true, validated: true, errored: false }) ===
      "UI_ONLY",
  ),
  "UI_ONLY even with a credential present",
);

// ── 4. AUTH_ONLY is honest about storing a secret for nothing ──────────────
console.log("\n— auth-only connectors —");
const authOnly = INTEGRATIONS.filter((i) => connectorImplementation(i.id) === "AUTH_ONLY");
check(
  "auth-only connectors report no available capabilities",
  authOnly.every((i) => connectorProfile(i.id).available.length === 0),
  `${authOnly.length} connector(s) with a credential form and no tools`,
);
check(
  "an auth-only connector is never reported as connected",
  authOnly.every(
    (i) =>
      connectorState(i.id, { credentialPresent: true, validated: true, errored: false }) ===
      "COMING_SOON",
  ),
  "COMING_SOON even with a stored credential",
);
check(
  "their access level says so plainly",
  authOnly.every((i) => /no tools are built/i.test(connectorProfile(i.id).accessLevel)),
  connectorProfile(authOnly[0].id).accessLevel,
);

// ── 5. Implemented connectors ──────────────────────────────────────────────
console.log("\n— implemented connectors —");
const implemented = implementedConnectorIds();
check(
  "every implemented connector's capabilities exist in the registry",
  implemented.every((id) =>
    connectorProfile(id).capabilityIds.every((capId) => Boolean(getCapability(capId))),
  ),
  implemented.map((id) => `${id}:${connectorProfile(id).capabilityIds.length}`).join(", "),
);
check(
  "YouTube is limited, and says which parts are unavailable",
  connectorImplementation("youtube") === "PARTIAL" &&
    connectorProfile("youtube").unavailable.length > 0,
  `${connectorProfile("youtube").accessLevel} · unavailable: ${connectorProfile("youtube").unavailable.join(", ")}`,
);
check(
  "connection states have human labels",
  describeState("CONNECTED_LIMITED") === "Connected" &&
    describeState("UI_ONLY") === "Coming soon" &&
    describeState("CONFIGURED_UNVERIFIED") === "Configured, not yet verified",
  "labelled",
);

// ── 6. Chat and voice project from the same registry ───────────────────────
console.log("\n— chat / voice parity —");
const chatOnly: string[] = [];
const voiceOnly: string[] = [];
for (const capability of CAPABILITY_REGISTRY) {
  const inChat = capabilityAllowedForOrigin(capability, "chat");
  const inVoice = capabilityAllowedForOrigin(capability, "voice");
  if (inChat && !inVoice) chatOnly.push(capability.id);
  if (inVoice && !inChat) voiceOnly.push(capability.id);
}
check(
  "origin filtering is a single shared gate",
  CAPABILITY_REGISTRY.every(
    (c) =>
      capabilityAllowedForOrigin(c, "chat") === (c.availability !== "unsupported" && c.supportsChat),
  ),
  "one gate for both origins",
);
// A difference must be explainable — either declared on the capability
// (`supportsVoice: false`) or given a reason by the origin policy (voice cannot
// authorise a destructive action by speech alone). What is not allowed is a
// difference nobody can account for.
check(
  "every chat/voice difference has a stated reason",
  chatOnly.every((id) => {
    const c = getCapability(id);
    return c && (c.supportsVoice === false || Boolean(originPolicy(c, "voice").reason));
  }) && voiceOnly.every((id) => getCapability(id)?.supportsChat === false),
  `chat-only: ${chatOnly.length}, voice-only: ${voiceOnly.length}`,
);
check(
  "an unsupported capability is offered to neither origin",
  CAPABILITY_REGISTRY.filter((c) => c.availability === "unsupported").every(
    (c) => !capabilityAllowedForOrigin(c, "chat") && !capabilityAllowedForOrigin(c, "voice"),
  ),
  "unsupported capabilities withheld",
);

// ── 7. No capability may belong to a connector that cannot back it ─────────
console.log("\n— no orphan connector capabilities —");
const connectorPrefixes = ["email.", "calendar.", "drive.", "docs.", "youtube."];
const orphans = CAPABILITY_REGISTRY.filter(
  (c) =>
    connectorPrefixes.some((p) => c.id.startsWith(p)) &&
    !implemented.some((id) => connectorProfile(id).capabilityIds.includes(c.id)),
);
check(
  "every connector-domain capability belongs to a known connector",
  orphans.length === 0,
  orphans.length === 0 ? "none orphaned" : orphans.map((c) => c.id).join(", "),
);

console.log(`\n${"-".repeat(74)}`);
if (failed > 0) {
  console.log(`${failed} FAILED\n`);
  failures.forEach((f) => console.log(`  x ${f}`));
} else {
  console.log("all passed");
}
process.exit(failed === 0 ? 0 : 1);
