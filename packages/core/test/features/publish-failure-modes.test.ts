// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { memoryPubSub } from "@ws-kit/memory";
import { withPubSub } from "@ws-kit/pubsub";
import { createRouter, message, z } from "@ws-kit/zod";
import { describe, expect, it } from "bun:test";

const TestMessage = message("TEST", { text: z.string() });

describe("publish() failure modes", () => {
  describe("never rejects", () => {
    it("publish() never rejects for any failure reason", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      // Invalid payload is accepted (no router-level validation)
      const r1 = await router.publish("topic", TestMessage, {
        text: 123 as any,
      });
      expect(r1).toBeDefined();
      expect(typeof r1 === "object").toBe(true);

      // excludeSelf filtering (handled by plugin layer)
      const r2 = await router.publish(
        "topic",
        TestMessage,
        { text: "hi" },
        { excludeSelf: true },
      );
      expect(r2).toBeDefined();
      expect(r2.ok).toBe(true);

      // All results should have ok field
      expect("ok" in r1).toBe(true);
      expect("ok" in r2).toBe(true);

      // Success results should have capability
      if (r1.ok) {
        expect(r1.capability).toBeDefined();
      }
    });
  });

  describe("payload handling", () => {
    it("accepts any payload without validation at router level", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      // router.publish() does not validate payloads.
      // Validation is the responsibility of validator plugin + middleware at handler level.
      // This test confirms that invalid payloads are accepted by router.publish()
      // (validation would happen in ctx.publish or ctx.send via middleware if configured).
      const result = await router.publish("topic", TestMessage, {
        text: 123 as any,
      });

      // Even with invalid payload, router.publish succeeds
      // because validation is not router's responsibility
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capability).toBeDefined();
      }
    });
  });

  describe("excludeSelf option handling", () => {
    it("handles excludeSelf:true option in publish", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      // excludeSelf filtering is handled by the pubsub plugin via excludeClientId
      // in envelope metadata. router.publish() has no sender context, but still succeeds.
      const result = await router.publish(
        "topic",
        TestMessage,
        { text: "hello" },
        { excludeSelf: true },
      );

      // excludeSelf is supported - should succeed
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capability).toBe("exact");
      }
    });
  });

  describe("success cases", () => {
    it("returns { ok: true } with capability and matched count", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      const result = await router.publish("topic", TestMessage, {
        text: "hello",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.capability).toMatch(/^(exact|estimate|unknown)$/);
        if (result.capability !== "unknown") {
          expect(typeof result.matched).toBe("number");
          expect(result.matched).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("result exhaustiveness", () => {
    it("covers all PublishError values with never type", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      const result = await router.publish("topic", TestMessage, {
        text: "test",
      });

      if (result.ok) {
        // Success path
        expect(result.capability).toMatch(/^(exact|estimate|unknown)$/);
      } else {
        // Failure path - exhaustiveness check
        switch (result.error) {
          case "VALIDATION":
          case "ACL_PUBLISH":
          case "STATE":
          case "BACKPRESSURE":
          case "PAYLOAD_TOO_LARGE":
          case "UNSUPPORTED":
          case "ADAPTER_ERROR":
          case "CONNECTION_CLOSED":
            break;
          default: {
            const _: never = result.error;
            throw new Error(`Unhandled error: ${_}`);
          }
        }
      }
    });
  });

  describe("error field and retryable", () => {
    it("provides both 'error' code and 'retryable' flag for failures", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      const result = await router.publish("topic", TestMessage, {
        text: 123 as any,
      });

      if (!result.ok) {
        expect("error" in result).toBe(true);
        expect("retryable" in result).toBe(true);
        expect(typeof result.error).toBe("string");
        expect(typeof result.retryable).toBe("boolean");
      }
    });
  });

  describe("capability semantics", () => {
    it("always includes matched in success result", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      const result = await router.publish("topic", TestMessage, {
        text: "test",
      });

      if (result.ok) {
        expect(typeof result.matched).toBe("number");
        expect(result.matched).toBeGreaterThanOrEqual(0);
      }
    });

    it("MemoryPubSub provides exact capability", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      const result = await router.publish("topic", TestMessage, {
        text: "test",
      });

      if (result.ok) {
        expect(result.capability).toBe("exact");
        expect(typeof result.matched).toBe("number");
      }
    });
  });

  describe("error code semantics", () => {
    it("handles excludeSelf gracefully (pubsub plugin filters locally)", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      const result = await router.publish(
        "topic",
        TestMessage,
        { text: "test" },
        { excludeSelf: true },
      );

      // Memory adapter now accepts excludeSelf - filtering is handled
      // by the pubsub plugin via excludeClientId in envelope metadata
      expect(result.ok).toBe(true);
    });
  });

  describe("optional adapter and details fields", () => {
    it("may include adapter name and details context in failure response", async () => {
      const router = createRouter().plugin(
        withPubSub({ adapter: memoryPubSub() }),
      );

      const result = await router.publish("topic", TestMessage, {
        text: "test",
      });

      if (!result.ok) {
        // adapter and details fields are optional
        expect(
          typeof result.adapter === "undefined" ||
            typeof result.adapter === "string",
        ).toBe(true);
        expect(
          typeof result.details === "undefined" ||
            typeof result.details === "object",
        ).toBe(true);
      }
    });
  });
});
