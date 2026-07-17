/**
 * Side-effect and confirmation policy helpers.
 */

import type { IntentContract, SideEffectClass } from "./IntentContract";

export function requiresConfirmation(contract: IntentContract): boolean {
  if (contract.explicitConfirmation) return true;
  if (contract.mode === "send" || contract.mode === "delete") return true;
  if (contract.sideEffect === "destructive") return true;
  return false;
}

export function allowsSideEffect(
  contract: IntentContract,
  proposed: SideEffectClass,
): boolean {
  const rank: Record<SideEffectClass, number> = {
    none: 0,
    "read-only": 1,
    reversible: 2,
    "external-write": 3,
    destructive: 4,
    privileged: 5,
  };
  return rank[proposed] <= rank[contract.sideEffect];
}
