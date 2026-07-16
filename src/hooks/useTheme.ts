import { useEffect } from "react";
import type { Settings } from "../types";

/**
 * Applies the persisted appearance preferences to the document root:
 * `data-theme` ("dark" | "light", resolving "system" against Windows) and the
 * `reduce-motion` class. The overlay window intentionally skips theming
 * (`applyTheme: false`) — the capsule is always the dark charcoal design —
 * but still honors reduced motion.
 */
export function useAppearance(
  settings: Settings | null,
  options: { applyTheme: boolean },
) {
  const { applyTheme } = options;
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.classList.toggle("reduce-motion", settings.reducedMotion);
    if (!applyTheme) return;

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const resolve = () => {
      const theme =
        settings.theme === "system"
          ? media.matches
            ? "light"
            : "dark"
          : settings.theme;
      root.dataset.theme = theme;
    };
    resolve();
    media.addEventListener("change", resolve);
    return () => media.removeEventListener("change", resolve);
  }, [settings, applyTheme]);
}
