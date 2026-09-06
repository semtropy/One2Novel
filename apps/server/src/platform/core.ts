import { createHash, randomUUID } from 'node:crypto';
export const uuid = randomUUID;
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: unknown,
  code: string,
  message: string,
  status = 422,
): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value)
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  throw new AppError('INVALID_JSON', '不允许 undefined 或非有限数值');
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const normalize = (s: string) => {
  requireThat(!s.includes('\0'), 'INVALID_TEXT', '正文含 NUL');
  return s
    .normalize('NFC')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
export const bodyLength = (s: string) => [...normalize(s)].filter((c) => !/\s/u.test(c)).length;
export const asJson = <T>(value: T) => JSON.parse(JSON.stringify(value));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function identifiers(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string' && uuidPattern.test(value)) into.add(value);
  else if (Array.isArray(value)) value.forEach((v) => identifiers(v, into));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (uuidPattern.test(k)) into.add(k);
      identifiers(v, into);
    }
  return into;
}
// A model may propose UUID-shaped temporary identities; only the server allocates durable new IDs.
export function remapProposal<T>(proposal: T, known: Set<string>): T {
  const mapping = new Map<string, string>();
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (
        typeof o.id === 'string' &&
        uuidPattern.test(o.id) &&
        !known.has(o.id) &&
        !mapping.has(o.id)
      )
        mapping.set(o.id, uuid());
      Object.values(o).forEach(collect);
    }
  };
  collect(proposal);
  const replace = (s: string) =>
    mapping.get(s) ||
    s
      .split(':')
      .map((part) => mapping.get(part) || part)
      .join(':');
  const walk = (v: unknown): unknown =>
    typeof v === 'string'
      ? replace(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, value]) => [replace(k), walk(value)]))
          : v;
  return walk(proposal) as T;
}
