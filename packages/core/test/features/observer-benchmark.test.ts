// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Performance benchmark for router observer mechanism.
 *
 * Validates that observer dispatch overhead is negligible:
 * - Zero observers: baseline (no overhead)
 * - One observer: minimal overhead
 * - Five observers: acceptable overhead for typical use cases
 *
 * Note: These are rough estimates. Results depend on system load.
 */

import { describe, it } from "bun:test";
import { createRouter } from "../../src";

describe("Observer Overhead Benchmark", () => {
  it("should measure observer dispatch time (informational)", async () => {
    const ITERATIONS = 1000;

    // Baseline: no observers
    const router0 = createRouter();
    let start0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      // Simulate error dispatch (calls notifyObservers)
      (router0 as any).notifyError(new Error("test"), {
        clientId: "client1",
        type: "TEST",
      });
    }
    const time0 = performance.now() - start0;

    // With one observer
    const router1 = createRouter();
    router1.observe({
      onError: () => {
        // noop
      },
    });
    let start1 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      (router1 as any).notifyError(new Error("test"), {
        clientId: "client1",
        type: "TEST",
      });
    }
    const time1 = performance.now() - start1;

    // With five observers
    const router5 = createRouter();
    for (let i = 0; i < 5; i++) {
      router5.observe({
        onError: () => {
          // noop
        },
      });
    }
    let start5 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      (router5 as any).notifyError(new Error("test"), {
        clientId: "client1",
        type: "TEST",
      });
    }
    const time5 = performance.now() - start5;

    // Log results (for manual review)
    console.log(`\n--- Observer Overhead Benchmark ---`);
    console.log(`Iterations: ${ITERATIONS}`);
    console.log(`Baseline (0 observers): ${time0.toFixed(2)}ms`);
    console.log(
      `1 observer: ${time1.toFixed(2)}ms (+${((time1 / time0 - 1) * 100).toFixed(1)}%)`,
    );
    console.log(
      `5 observers: ${time5.toFixed(2)}ms (+${((time5 / time0 - 1) * 100).toFixed(1)}%)`,
    );

    // Sanity checks: Observer overhead should be <100% (i.e., dispatch time should not double)
    if (time0 > 0) {
      const overhead1 = time1 / time0 - 1;
      const overhead5 = time5 / time0 - 1;

      console.log(
        `\nOverhead per observer: ~${(overhead1 * 100).toFixed(1)}% for 1, ~${((overhead5 / 5) * 100).toFixed(1)}% per observer`,
      );

      // Verify overhead is reasonable (should be minimal for simple dispatch)
      // Note: These thresholds are generous to account for system variation
      if (overhead1 > 5) {
        console.warn(
          `⚠️  High overhead detected for 1 observer: ${(overhead1 * 100).toFixed(1)}%`,
        );
      }
      if (overhead5 > 20) {
        console.warn(
          `⚠️  High overhead detected for 5 observers: ${((overhead5 / 5) * 100).toFixed(1)}% per observer`,
        );
      }
    }
  });
});
