/**
 * What ArcSonare can do with a watched application. Mirrors
 * `src-tauri/src/watch/abilities.rs`.
 *
 * `availability` is the field that matters most. A closed application keeps
 * every ability it has — what changes is *when*. Presenting "4 actions
 * available" on an application that is not running is the failure this type
 * exists to make impossible: the counts are computed from these three states,
 * never from the length of the list.
 */

export type AbilityAvailability = "now" | "after-reopening" | "unsupported";

export interface Ability {
  /** Plain description, written for a person. Safe to show and to speak. */
  label: string;
  /** The capability behind it. Diagnostics only — never shown in normal mode. */
  capabilityId?: string;
  availability: AbilityAvailability;
  /** Why, when unsupported or conditional. */
  note?: string;
}

export interface ApplicationAbilities {
  appCatalogId: string;
  displayName: string;
  running: boolean;
  abilities: Ability[];
  /** One sentence naming what this application is for, in this context. */
  summary: string;
}

export function availableNow(app: ApplicationAbilities): Ability[] {
  return app.abilities.filter((a) => a.availability === "now");
}

export function afterReopening(app: ApplicationAbilities): Ability[] {
  return app.abilities.filter((a) => a.availability === "after-reopening");
}

export function unsupported(app: ApplicationAbilities): Ability[] {
  return app.abilities.filter((a) => a.availability === "unsupported");
}

/**
 * The count a row may display.
 *
 * Returns both numbers rather than one. A caller that wants "4 actions" has to
 * decide which four it means, which is the point — "4 actions available" on a
 * closed application was the reported defect.
 */
export function abilityCounts(app: ApplicationAbilities): {
  now: number;
  afterReopening: number;
} {
  return {
    now: availableNow(app).length,
    afterReopening: afterReopening(app).length,
  };
}
