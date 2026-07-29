/**
 * Completes first-run / auth welcome and lands on the Command Center.
 * Kept separate so sign-in, sign-up, and "continue" share one safe path.
 */
import { navigate } from "../stores/appStore";
import { patchPrefs } from "../stores/settingsStore";

export function completeOnboarding(options?: { unlockOverlay?: boolean }): void {
  const unlockOverlay = options?.unlockOverlay ?? false;
  patchPrefs("general", {
    onboardingDone: true,
    ...(unlockOverlay ? { overlayUnlocked: true } : {}),
  });
  navigate("dashboard");
  // Refresh workspace data after the auth shell unmounts.
  void import("../stores/taskStore").then((m) => m.hydrateTasksFromDb());
  void import("../features/agents/agentStore").then((m) => m.hydrateAgentsFromDb());
  void import("../features/account/accountProfile").then((m) =>
    m.hydrateProfileDisplayName(),
  );
}
