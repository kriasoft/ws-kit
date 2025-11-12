import { describe, it, expect } from "bun:test";
import { z, message, createRouter } from "@ws-kit/zod";
import { MemoryPubSub } from "@ws-kit/pubsub/internal";

const TestMessage = message("TEST", { text: z.string() });

describe("publish() failure modes", () => {
  describe("never rejects", () => {
    it("publish() never rejects for any failure reason", async () => {
      const router = createRouter({ pubsub: new MemoryPubSub() });

      // Invalid payload (validation failure)
      const r1 = await router.publish("topic", TestMessage, { text: 123 });
      expect(r1).toBeDefined();
      expect(typeof r1 === "object").toBe(true);

      // excludeSelf unsupported
      const r2 = await router.publish(
        "topic",
        TestMessage,
        { text: "hi" },
        { excludeSelf: true },
      );
      expect(r2).toBeDefined();
      expect(typeof r2 === "object").toBe(true);

      // All results should have ok field
      expect("ok" in r1).toBe(true);
      expect("ok" in r2).toBe(true);
    });
  });

  describe("validation failure", () => {
    it('returns { ok: false, error: "VALIDATION" } for invalid payload', async () => {
      const router = createRouter({ pubsub: new MemoryPubSub() });

      // @ts-expect-error - intentional invalid payload
      const result = await router.publish("topic", TestMessage, { text: 123 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("VALIDATION");
        expect(result.retryable).toBe(false);
        expect(result.cause).toBeInstanceOf(Error);
      }
    });
  });

  describe("unsupported feature", () => {
    it('returns { ok: false, error: "UNSUPPORTED" } for excludeSelf:true', async () => {
      const router = createRouter({ pubsub: new MemoryPubSub() });

      const result = await router.publish(
        "topic",
        TestMessage,
        { text: "hello" },
        { excludeSelf: true },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("UNSUPPORTED");
        expect(result.retryable).toBe(false);
        expect(result.cause).toBeInstanceOf(Error);
        expect(result.details?.feature).toBe("excludeSelf");
      }
    });
  });

  describe("success cases", () => {
    it("returns { ok: true } with capability and matched count", async () => {
      const router = createRouter({ pubsub: new MemoryPubSub() });

      const result = await router.publish("topic", TestMessage, {
        text: "hello",
      });

      expect(result.ok).toBe(true);
      expect(result.capability).toMatch(/^(exact|estimate|unknown)$/);
      expect(typeof result.matched).toBe("number");
      expect(result.matched).toBeGreaterThanOrEqual(0);
    });
  });

  describe("result exhaustiveness", () => {
    it("covers all PublishError values with never type", async () => {
      const router = createRouter({ pubsub: new MemoryPubSub() });

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
          case "ACL":
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
      const router = createRouter({ pubsub: new MemoryPubSub() });

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
      const router = createRouter({ pubsub: new MemoryPubSub() });

      const result = await router.publish("topic", TestMessage, {
        text: "test",
      });

      if (result.ok) {
        expect(typeof result.matched).toBe("number");
        expect(result.matched).toBeGreaterThanOrEqual(0);
      }
    });

    it("MemoryPubSub provides exact capability", async () => {
      const router = createRouter({ pubsub: new MemoryPubSub() });

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
    it("maps UNSUPPORTED error for excludeSelf:true", async () => {
      const router = createRouter({ pubsub: new MemoryPubSub() });

      const result = await router.publish(
        "topic",
        TestMessage,
        { text: "test" },
        { excludeSelf: true },
      );

      if (!result.ok && result.error === "UNSUPPORTED") {
        // details provides context about what feature is unsupported
        expect(result.details?.feature).toBe("excludeSelf");
      }
    });
  });

  describe("optional adapter and details fields", () => {
    it("may include adapter name and details context in failure response", async () => {
      const router = createRouter({ pubsub: new MemoryPubSub() });

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
