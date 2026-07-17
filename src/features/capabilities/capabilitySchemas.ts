/**
 * Minimal JSON-schema validation for capability arguments. The Rust side
 * re-validates with strict serde; this local pass rejects bad model output
 * before anything native runs and gives the model actionable feedback.
 */
import type { JSONSchema } from "./capabilityTypes";

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function typeMatches(expected: unknown, value: unknown): boolean {
  const actual = typeOf(value);
  if (Array.isArray(expected)) {
    return (expected as string[]).some((t) => singleTypeMatches(t, actual, value));
  }
  return singleTypeMatches(String(expected), actual, value);
}

function singleTypeMatches(expected: string, actual: string, value: unknown): boolean {
  if (expected === actual) return true;
  if (expected === "integer") {
    return actual === "number" && Number.isInteger(value as number);
  }
  return false;
}

export function validateArguments(
  schema: JSONSchema,
  args: Record<string, unknown>,
): ValidationOutcome {
  const errors: string[] = [];
  const properties = (schema.properties ?? {}) as Record<string, JSONSchema>;
  const required = (schema.required ?? []) as string[];
  const additional = schema.additionalProperties !== false;

  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      errors.push(`missing required field "${key}"`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) {
      if (!additional && !key.startsWith("__")) {
        errors.push(`unknown field "${key}"`);
      }
      continue;
    }
    if (value === undefined || value === null) {
      // Optional / nullable — Rust rejects if truly disallowed.
      continue;
    }
    if (prop.type && !typeMatches(prop.type, value)) {
      errors.push(`field "${key}" must be ${JSON.stringify(prop.type)}`);
      continue;
    }
    const allowed = prop.enum as unknown[] | undefined;
    if (allowed && !allowed.includes(value)) {
      errors.push(`field "${key}" must be one of ${JSON.stringify(allowed.filter((v) => v !== null))}`);
    }
    if (typeof value === "string") {
      const min = prop.minLength as number | undefined;
      const max = prop.maxLength as number | undefined;
      if (min !== undefined && value.length < min) errors.push(`field "${key}" is too short`);
      if (max !== undefined && value.length > max) errors.push(`field "${key}" is too long`);
    }
    if (typeof value === "number") {
      const min = prop.minimum as number | undefined;
      const max = prop.maximum as number | undefined;
      if (min !== undefined && value < min) errors.push(`field "${key}" must be ≥ ${min}`);
      if (max !== undefined && value > max) errors.push(`field "${key}" must be ≤ ${max}`);
    }
    if (Array.isArray(value)) {
      const minItems = prop.minItems as number | undefined;
      const maxItems = prop.maxItems as number | undefined;
      if (minItems !== undefined && value.length < minItems)
        errors.push(`field "${key}" needs at least ${minItems} items`);
      if (maxItems !== undefined && value.length > maxItems)
        errors.push(`field "${key}" allows at most ${maxItems} items`);
    }
  }
  return { valid: errors.length === 0, errors };
}
