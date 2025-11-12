// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "bun:test";
import { FakeClock } from "../../src/testing";

describe("FakeClock", () => {
  describe("Basic time control", () => {
    it("should start at time 0", () => {
      const clock = new FakeClock();
      expect(clock.now()).toBe(0);
    });

    it("should advance time with tick()", async () => {
      const clock = new FakeClock();
      await clock.tick(1000);
      expect(clock.now()).toBe(1000);

      await clock.tick(500);
      expect(clock.now()).toBe(1500);
    });

    it("should reset to 0 and clear timers", async () => {
      const clock = new FakeClock();
      await clock.tick(5000);
      expect(clock.now()).toBe(5000);

      clock.reset();
      expect(clock.now()).toBe(0);
      expect(clock.pendingTimers()).toEqual([]);
    });
  });

  describe("setTimeout", () => {
    it("should run timeouts at the correct time", async () => {
      const clock = new FakeClock();
      const calls: number[] = [];

      const id1 = clock.setTimeout(() => calls.push(1), 100);
      const id2 = clock.setTimeout(() => calls.push(2), 200);
      const id3 = clock.setTimeout(() => calls.push(3), 50);

      expect(calls).toEqual([]);

      await clock.tick(50);
      expect(calls).toEqual([3]);

      await clock.tick(50); // total 100
      expect(calls).toEqual([3, 1]);

      await clock.tick(100); // total 200
      expect(calls).toEqual([3, 1, 2]);
    });

    it("should support clearTimeout", async () => {
      const clock = new FakeClock();
      const calls: number[] = [];

      const id = clock.setTimeout(() => calls.push(1), 100);
      clock.clearTimeout(id);

      await clock.tick(150);
      expect(calls).toEqual([]);
    });

    it("should execute timers in FIFO order for same due time", async () => {
      const clock = new FakeClock();
      const calls: number[] = [];

      clock.setTimeout(() => calls.push(1), 100);
      clock.setTimeout(() => calls.push(2), 100);
      clock.setTimeout(() => calls.push(3), 100);

      await clock.tick(100);
      expect(calls).toEqual([1, 2, 3]);
    });
  });

  describe("setInterval", () => {
    it("should repeat at regular intervals", async () => {
      const clock = new FakeClock();
      const calls: number[] = [];

      clock.setInterval(() => calls.push(1), 100);

      await clock.tick(100);
      expect(calls).toEqual([1]);

      await clock.tick(100);
      expect(calls).toEqual([1, 1]);

      await clock.tick(300);
      expect(calls).toEqual([1, 1, 1, 1]);
    });

    it("should support clearInterval", async () => {
      const clock = new FakeClock();
      const calls: number[] = [];

      const id = clock.setInterval(() => calls.push(1), 100);

      await clock.tick(100);
      expect(calls).toEqual([1]);

      clock.clearInterval(id);

      await clock.tick(100);
      expect(calls).toEqual([1]); // No second call
    });

    it("should allow clearing and clearing another interval mid-execution", async () => {
      const clock = new FakeClock();
      const calls: number[] = [];

      const id1 = clock.setInterval(() => {
        calls.push(1);
        if (calls.length === 2) {
          clock.clearInterval(id1);
        }
      }, 100);

      await clock.tick(100);
      expect(calls).toEqual([1]);

      await clock.tick(100);
      expect(calls).toEqual([1, 1]);

      await clock.tick(100);
      expect(calls).toEqual([1, 1]); // Cleared after second run
    });
  });

  describe("flush", () => {
    it("should flush microtasks without advancing time", async () => {
      const clock = new FakeClock();
      const calls: string[] = [];

      const id = clock.setTimeout(() => {
        calls.push("timeout");
      }, 100);

      Promise.resolve().then(() => {
        calls.push("microtask");
      });

      expect(calls).toEqual([]);

      await clock.flush();
      expect(calls).toEqual(["microtask"]);
      expect(clock.now()).toBe(0);

      await clock.tick(100);
      expect(calls).toEqual(["microtask", "timeout"]);
    });
  });

  describe("pendingTimers", () => {
    it("should report pending timers", async () => {
      const clock = new FakeClock();

      const id1 = clock.setTimeout(() => {}, 100);
      const id2 = clock.setInterval(() => {}, 200);

      const pending = clock.pendingTimers();
      expect(pending.length).toBe(2);
      expect(
        pending.some((t) => t.isInterval === false && t.dueAt === 100),
      ).toBe(true);
      expect(
        pending.some((t) => t.isInterval === true && t.dueAt === 200),
      ).toBe(true);
    });

    it("should report zero pending timers after all run", async () => {
      const clock = new FakeClock();
      clock.setTimeout(() => {}, 100);
      clock.setTimeout(() => {}, 200);

      await clock.tick(200);
      expect(clock.pendingTimers()).toEqual([]);
    });
  });

  describe("Error handling", () => {
    it("should swallow errors in timers (like native behavior)", async () => {
      const clock = new FakeClock();
      let threwError = false;

      clock.setTimeout(() => {
        throw new Error("Timer error");
      }, 100);

      try {
        await clock.tick(100);
        threwError = false;
      } catch {
        threwError = true;
      }

      expect(threwError).toBe(false); // Error was swallowed
    });
  });
});
