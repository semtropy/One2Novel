type Handler = (...args: unknown[]) => void | Promise<void>;

interface Listener {
  handler: Handler;
  priority: number;
}

export class EventBus {
  private listeners = new Map<string, Listener[]>();

  on(event: string, handler: Handler, priority = 0): void {
    const list = this.listeners.get(event) ?? [];
    list.push({ handler, priority });
    list.sort((a, b) => b.priority - a.priority);
    this.listeners.set(event, list);
  }

  off(event: string, handler: Handler): void {
    const list = this.listeners.get(event);
    if (!list) return;
    this.listeners.set(
      event,
      list.filter((l) => l.handler !== handler),
    );
  }

  async emit(event: string, ...args: unknown[]): Promise<void> {
    const list = this.listeners.get(event);
    if (!list) return;
    for (const { handler } of list) {
      await handler(...args);
    }
  }
}

export const novelEventBus = new EventBus();
