// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Clock abstraction for deterministic testing.
 * FakeClock allows complete control over time in tests.
 * RealClock is a passthrough to native timers (for production).
 */

/**
 * Clock interface: abstracts setTimeout, setInterval, Date.now().
 * Used by features like heartbeat, limits, and test utilities.
 */
export interface Clock {
  /**
   * Schedule a function to run after delay (milliseconds).
   * Returns a timer ID that can be passed to clearTimeout.
   */
  setTimeout(fn: () => void, ms: number): unknown;

  /**
   * Clear a scheduled timeout.
   */
  clearTimeout(id: unknown): void;

  /**
   * Schedule a function to repeat every interval (milliseconds).
   * Returns a timer ID that can be passed to clearInterval.
   */
  setInterval(fn: () => void, ms: number): unknown;

  /**
   * Clear a scheduled interval.
   */
  clearInterval(id: unknown): void;

  /**
   * Current time in milliseconds since epoch (or fake clock start).
   */
  now(): number;
}

interface ScheduledTimer {
  id: unknown;
  fn: () => void;
  dueAt: number;
  isInterval: boolean;
  interval?: number;
}

/**
 * Fake clock for deterministic testing.
 * Supports full control over time progression and task scheduling.
 *
 * Usage:
 *   const clock = new FakeClock();
 *   await clock.tick(30_000); // Advance time 30s and run due timers
 *   await clock.flush();      // Flush microtasks without advancing time
 */
export class FakeClock implements Clock {
  private now_ = 0;
  private timers = new Map<unknown, ScheduledTimer>();
  private nextId = 0;
  private queue: ScheduledTimer[] = [];

  /**
   * Get current fake time.
   */
  now(): number {
    return this.now_;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    const timer: ScheduledTimer = {
      id,
      fn,
      dueAt: this.now_ + ms,
      isInterval: false,
    };
    this.timers.set(id, timer);
    this.enqueueTimer(timer);
    return id;
  }

  clearTimeout(id: unknown): void {
    this.timers.delete(id);
  }

  setInterval(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    const timer: ScheduledTimer = {
      id,
      fn,
      dueAt: this.now_ + ms,
      isInterval: true,
      interval: ms,
    };
    this.timers.set(id, timer);
    this.enqueueTimer(timer);
    return id;
  }

  clearInterval(id: unknown): void {
    this.timers.delete(id);
  }

  /**
   * Advance time by ms milliseconds and run all due timers.
   * Flushes microtasks between timer runs.
   * Repeats until no more timers are due.
   */
  async tick(ms: number): Promise<void> {
    this.now_ += ms;
    await this.runDueTimers();
  }

  /**
   * Flush pending microtasks without advancing time.
   * Useful after inbound messages to settle promise chains.
   */
  async flush(): Promise<void> {
    // Give microtasks a chance to run
    await Promise.resolve();
  }

  /**
   * Reset clock: clear all timers and set time to 0.
   */
  reset(): void {
    this.now_ = 0;
    this.timers.clear();
    this.queue = [];
    this.nextId = 0;
  }

  /**
   * Get list of pending timers (for debugging/leak detection).
   */
  pendingTimers(): { id: unknown; dueAt: number; isInterval: boolean }[] {
    return Array.from(this.timers.values()).map((t) => ({
      id: t.id,
      dueAt: t.dueAt,
      isInterval: t.isInterval,
    }));
  }

  // Private helpers

  private enqueueTimer(timer: ScheduledTimer): void {
    // Insert in sorted order (FIFO for same dueAt)
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (timer.dueAt < this.queue[i]!.dueAt) {
        this.queue.splice(i, 0, timer);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(timer);
    }
  }

  private async runDueTimers(): Promise<void> {
    // Record the initial time; only run timers that were due at or before current time
    const runUntil = this.now_;

    while (this.queue.length > 0 && this.queue[0]!.dueAt <= runUntil) {
      const timer = this.queue.shift()!;

      // Skip if timer was cleared
      if (!this.timers.has(timer.id)) {
        continue;
      }

      // Run the timer
      try {
        timer.fn();
      } catch (err) {
        // Swallow errors in timers (matches native behavior)
      }

      // If interval, reschedule for next occurrence; otherwise remove from map
      if (timer.isInterval && this.timers.has(timer.id)) {
        timer.dueAt += timer.interval!;
        this.enqueueTimer(timer);
      } else {
        // One-shot timer: remove it
        this.timers.delete(timer.id);
      }

      // Flush microtasks between timer runs
      await Promise.resolve();
    }
  }
}

/**
 * System clock: passthrough to native timers.
 * Use for production or when you don't need deterministic testing.
 */
export class SystemClock implements Clock {
  setTimeout(fn: () => void, ms: number): unknown {
    return globalThis.setTimeout(fn, ms);
  }

  clearTimeout(id: unknown): void {
    globalThis.clearTimeout(id as NodeJS.Timeout);
  }

  setInterval(fn: () => void, ms: number): unknown {
    return globalThis.setInterval(fn, ms);
  }

  clearInterval(id: unknown): void {
    globalThis.clearInterval(id as NodeJS.Timeout);
  }

  now(): number {
    return Date.now();
  }
}
