/**
 * Semaphore — bounded concurrency controller.
 *
 * Ensures at most `maxConcurrent` async operations run simultaneously.
 * Excess callers queue and wait for a slot.
 */
interface QueueEntry {
  resolve: () => void;
  reject: (e: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class Semaphore {
  private maxConcurrent: number;
  private current = 0;
  private queue: QueueEntry[] = [];

  constructor(maxConcurrent: number) {
    if (maxConcurrent < 1) throw new Error("Semaphore maxConcurrent must be >= 1");
    this.maxConcurrent = maxConcurrent;
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.current;
  }

  async acquire(timeoutMs?: number): Promise<void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }

    return new Promise((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject };
      this.queue.push(entry);

      if (timeoutMs) {
        entry.timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(new Error("Semaphore acquire timed out"));
        }, timeoutMs);
      }
    });
  }

  release(): void {
    this.current--;
    const entry = this.queue.shift();
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve();
    }
  }
}
