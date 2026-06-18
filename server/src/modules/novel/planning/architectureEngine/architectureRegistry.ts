/**
 * Architecture Registry — built-in templates REMOVED.
 *
 * Architecture profiles now come from two sources only:
 *   1. Reference book analysis (deep analysis pipeline → ArchitectureProfile)
 *   2. User manual editing (loop phases, rhythm parameters, etc.)
 *
 * Stub functions remain for backward compatibility — all return undefined/null.
 */
import type { ArchitectureType } from "./types";

export function getArchitectureTemplate(_id: ArchitectureType) {
  return undefined as any; // built-in templates removed — returns nothing
}

export function listArchitectureTemplates(): any[] {
  return []; // built-in templates removed
}

/** @deprecated Built-in templates removed. Use reference analysis or manual editing. */
export function buildExpectationProfile(_architectureType: ArchitectureType): null {
  return null;
}
