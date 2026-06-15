/**
 * Express 5 types `req.params` values as `string | string[]`.
 * This helper narrows to `string` for the common single-value case.
 * Throws if the value is actually an array (which shouldn't happen for normal route params).
 */

export function param(req: { params: Record<string, string | string[]> }, name: string): string {
  const v = req.params[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? "";
  return String(v ?? "");
}
