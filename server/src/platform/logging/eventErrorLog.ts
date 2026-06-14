/**
 * Structured error logging for event handlers and fire-and-forget side effects.
 * Replaces silent .catch(() => {}) and bare .catch(e => console.error(...)) calls.
 */

export function logEventError(
  eventName: string,
  context: Record<string, unknown>,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `[Event:${eventName}] ${message}`,
    JSON.stringify({ ...context, timestamp: new Date().toISOString() }),
  );
}

/**
 * Fire-and-forget wrapper that logs errors instead of silently discarding them.
 * Usage: runAsync(() => someAsyncOp(), "op-name", { novelId })
 */
export async function runAsync(
  fn: () => Promise<unknown>,
  label: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logEventError(label, context ?? {}, e);
  }
}
