// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Plugin API Tests
 *
 * Validates that withPubSub() works with the canonical single-object-parameter API.
 */

import { memoryPubSub } from "@ws-kit/memory";
import { createRouter, message, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";
import { withPubSub } from "./plugin.js";

const TestMessage = message("TEST", { text: z.string() });

describe("withPubSub() Plugin API", () => {
  describe("Canonical API: single object parameter", () => {
    it("should accept adapter only", () => {
      const router = createRouter().plugin(
        withPubSub({
          adapter: memoryPubSub(),
        }),
      );

      expect(router).toBeDefined();
    });

    it("should accept adapter with observer", () => {
      const router = createRouter().plugin(
        withPubSub({
          adapter: memoryPubSub(),
          observer: {
            onPublish: (rec) => {
              const _topic: string = rec.topic;
              const _payload: unknown = rec.payload;
            },
          },
        }),
      );

      expect(router).toBeDefined();
    });

    it("should accept all option groups: limits, topic, delivery", () => {
      const router = createRouter().plugin(
        withPubSub({
          adapter: memoryPubSub(),
          limits: {
            maxTopicsPerConn: 100,
          },
          topic: {
            normalize: (t) => t.toLowerCase(),
            validate: (t) => {
              if (!t) throw new Error("empty");
            },
          },
          delivery: {
            excludeSelfDefault: false,
          },
        }),
      );

      expect(router).toBeDefined();
    });

    it("should include all option groups in typedef", () => {
      const opts = {
        adapter: memoryPubSub(),
        observer: undefined as any,
        limits: {
          maxTopicsPerConn: 50,
        },
        topic: {
          normalize: (t: string) => t,
          validate: (t: string) => {},
        },
        delivery: {
          excludeSelfDefault: false,
        },
      };

      expect(opts.limits.maxTopicsPerConn).toBe(50);
      expect(opts.topic.normalize("TEST")).toBe("TEST");
      expect(opts.delivery.excludeSelfDefault).toBe(false);
    });
  });

  describe("Observer functionality", () => {
    it("should call observer from options", async () => {
      const observed: any[] = [];
      const router = createRouter<{ userId?: string }>().plugin(
        withPubSub({
          adapter: memoryPubSub(),
          observer: {
            onPublish: (rec) => {
              observed.push(rec);
            },
          },
        }),
      );

      // Create a mock handler and publish
      const result = await (router as any).publish("test-topic", TestMessage, {
        text: "hello",
      });

      expect(result.ok).toBe(true);
      expect(observed).toHaveLength(1);
      expect(observed[0].topic).toBe("test-topic");
      expect(observed[0].payload).toEqual({ text: "hello" });
    });
  });
});
