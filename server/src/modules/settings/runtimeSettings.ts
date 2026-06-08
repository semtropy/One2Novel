/** Simple runtime settings that override .env values. In-memory only, lost on restart. */

const overrides: Record<string, string> = {};

export function getSetting(key: string, fallback: string): string {
  return overrides[key] ?? process.env[key] ?? fallback;
}

export function setSetting(key: string, value: string): void {
  overrides[key] = value;
}

export function getAllSettings(): Record<string, string> {
  return { ...overrides };
}
