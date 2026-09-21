/**
 * Which requests reach the screen, and which never should.
 *
 * The bug this guards against is not a crash — it is ArcSonare quietly deciding
 * that "open the ArcSonare folder" means screenshot, find the icon, move the
 * cursor, double-click. That path is slower, hijacks the user's mouse, and fails
 * whenever the icon is covered. Every assertion here is about a request being
 * turned into a *native* action, with a target Rust can resolve on its own.
 *
 * Run: npx tsx scripts/check-planner-routing.mts
 */

import {
  isPlannedCapability,
  toActionRequest,
} from "../src/features/capabilities/plannerBridge";

let failed = 0;
const check = (name: string, pass: boolean, got: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      -> ${got}`);
};

const req = (id: string, args: Record<string, unknown>) =>
  toActionRequest(id, args, "chat");

// --------------------------------------------------------------- open a folder
{
  const r = req("filesystem.open_item", { path: "desktop/ArcSonare" });
  check(
    "opening a folder becomes a native path request",
    r?.intent === "open-folder" && r.target.kind === "path",
    `intent=${r?.intent} target=${r?.target.kind}`,
  );
  check(
    "a known folder is handed to Rust as a known folder, not a guessed path",
    r?.target.knownFolder === "desktop" && r.target.name === "ArcSonare",
    // Rust resolves a redirected (OneDrive) Desktop; a literal path would miss it.
    `knownFolder=${String(r?.target.knownFolder)} name=${String(r?.target.name)}`,
  );
}
{
  const r = req("filesystem.open_item", {
    path: "C:\\Users\\rober\\Desktop\\ArcSonare",
  });
  check(
    "an absolute path stays an absolute path",
    r?.target.knownFolder === null && typeof r?.target.path === "string",
    `path=${String(r?.target.path)}`,
  );
}
{
  const r = req("filesystem.open_item", { path: "downloads/report.pdf" });
  check(
    "a file is labelled a file, not a folder",
    r?.intent === "open-file",
    `intent=${r?.intent}`,
  );
}

// ----------------------------------------------------------- launch / focus
{
  const r = req("applications.open", { query: "Spotify" });
  check(
    "launching an app never becomes a visual search",
    r?.intent === "launch-application" && r.target.kind === "application",
    `intent=${r?.intent} target=${r?.target.kind}`,
  );
  check(
    "the app name is carried, not a desktop-icon description",
    r?.target.appName === "Spotify",
    `appName=${String(r?.target.appName)}`,
  );
}
{
  const r = req("applications.focus", { query: "Spotify" });
  check(
    "focusing an existing window is its own intent",
    r?.intent === "focus-application",
    `intent=${r?.intent}`,
  );
}

// --------------------------------------------------------------- url / settings
{
  const r = req("web.open_url", { url: "https://github.com" });
  check(
    "a URL is opened natively",
    r?.intent === "open-url" && r.target.url === "https://github.com",
    `intent=${r?.intent} url=${String(r?.target.url)}`,
  );
}
{
  const r = req("system.open_settings", { page: "wi-fi" });
  check(
    "Wi-Fi settings is a settings page, not a taskbar icon to click",
    r?.intent === "open-system-settings" && r.target.page === "wi-fi",
    `intent=${r?.intent} page=${String(r?.target.page)}`,
  );
}

// ------------------------------------------------------------- the boundary
{
  const nativeIds = [
    "applications.open",
    "applications.focus",
    "filesystem.open_item",
    "web.open_url",
    "system.open_settings",
  ];
  check(
    "every native action is planner-routed",
    nativeIds.every(isPlannedCapability),
    nativeIds.filter((id) => !isPlannedCapability(id)).join(", ") || "all routed",
  );

  const visualIds = ["screen.capture", "input.click_at", "screen.highlight_target"];
  check(
    "screen and cursor capabilities are not silently absorbed by the planner",
    // They keep their existing path until the capture-ownership migration lands;
    // routing them now would only send more traffic into a known-broken executor.
    visualIds.every((id) => !isPlannedCapability(id)),
    visualIds.filter(isPlannedCapability).join(", ") || "none absorbed",
  );

  const requests = nativeIds.map((id) =>
    req(id, { query: "x", path: "desktop/x", url: "https://x.dev", page: "wi-fi" }),
  );
  check(
    "no native request ever carries a visual target",
    requests.every((r) => r !== null && r.target.kind !== "visual-description"),
    requests.map((r) => r?.target.kind).join(", "),
  );
  check(
    "no native request self-approves a confirmation",
    requests.every((r) => r?.confirmationState === undefined),
    // Approval comes from the user through the engine, never from the payload.
    requests.map((r) => String(r?.confirmationState)).join(", "),
  );
}

console.log(failed === 0 ? "\nAll planner routing checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
