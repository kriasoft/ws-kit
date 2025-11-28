// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests: Plugin chaining preserves extensions
 *
 * These tests verify that chaining multiple plugins via .plugin()
 * correctly accumulates all capability markers and APIs. This is
 * critical for type-safe capability gating (rpc(), publish(), etc.).
 *
 * The fix uses this-aware inference in plugin() signatures to preserve
 * existing extensions when adding new ones.
 */

import type {
  MessageDescriptor,
  Plugin,
  Router,
  RouterCore,
  RouterWithExtensions,
} from "@ws-kit/core";
import { createRouter } from "@ws-kit/core";
import { describe, expectTypeOf, it } from "bun:test";

// Mock plugin APIs for testing
interface MockValidationAPI {
  validation: true;
  rpc(schema: MessageDescriptor, handler: () => void): Router<any, any>;
}

interface MockPubSubAPI {
  pubsub: true;
  publish(topic: string, schema: MessageDescriptor, payload: unknown): void;
  topics: { list(): string[]; has(t: string): boolean };
}

interface MockMetricsAPI {
  metrics: { track(event: string): void };
}

// Mock plugins
const mockValidation: Plugin<any, MockValidationAPI> = (router) =>
  Object.assign(router, {
    validation: true as const,
    rpc: () => router,
  }) as any;

const mockPubSub: Plugin<any, MockPubSubAPI> = (router) =>
  Object.assign(router, {
    pubsub: true as const,
    publish: () => {},
    topics: { list: () => [], has: () => false },
  }) as any;

const mockMetrics: Plugin<any, MockMetricsAPI> = (router) =>
  Object.assign(router, {
    metrics: { track: () => {} },
  }) as any;

describe("plugin chaining type inference", () => {
  describe("single plugin", () => {
    it("adds plugin API to router", () => {
      const router = createRouter().plugin(mockValidation);

      // Plugin API method available
      expectTypeOf(router).toHaveProperty("rpc");
      // Base router methods preserved
      expectTypeOf(router).toHaveProperty("on");
      expectTypeOf(router).toHaveProperty("use");
      expectTypeOf(router).toHaveProperty("plugin");
    });
  });

  describe("two plugins", () => {
    it("preserves first plugin API after second plugin", () => {
      const router = createRouter().plugin(mockValidation).plugin(mockPubSub);

      // Both plugin APIs available (markers are internal, check methods)
      expectTypeOf(router).toHaveProperty("rpc");
      expectTypeOf(router).toHaveProperty("publish");
      expectTypeOf(router).toHaveProperty("topics");
    });

    it("order independence: pubsub then validation", () => {
      const router = createRouter().plugin(mockPubSub).plugin(mockValidation);

      // Both APIs available regardless of order
      expectTypeOf(router).toHaveProperty("rpc");
      expectTypeOf(router).toHaveProperty("publish");
    });
  });

  describe("three+ plugins", () => {
    it("preserves all APIs through long chains", () => {
      const router = createRouter()
        .plugin(mockValidation)
        .plugin(mockPubSub)
        .plugin(mockMetrics);

      // All three plugin APIs available (check methods, not markers)
      expectTypeOf(router).toHaveProperty("rpc");
      expectTypeOf(router).toHaveProperty("publish");
      expectTypeOf(router).toHaveProperty("metrics");
    });
  });

  describe("fluent chaining after plugins", () => {
    it("preserves extensions through .use()", () => {
      const router = createRouter()
        .plugin(mockValidation)
        .plugin(mockPubSub)
        .use(async (_ctx, next) => next());

      // Extensions preserved after .use()
      expectTypeOf(router).toHaveProperty("rpc");
      expectTypeOf(router).toHaveProperty("publish");
    });

    it("preserves extensions through .on() (type-only)", () => {
      // Type-level only: verify .on() return type preserves extensions
      // We don't actually call .on() because it requires a valid schema at runtime
      type ChainedRouter =
        ReturnType<typeof createRouter<any>> extends Router<any, infer E>
          ? RouterWithExtensions<any, E & MockValidationAPI & MockPubSubAPI>
          : never;

      type AfterOn = ReturnType<ChainedRouter["on"]>;

      // Extensions preserved in .on() return type
      type HasRpc = "rpc" extends keyof AfterOn ? true : false;
      type HasPublish = "publish" extends keyof AfterOn ? true : false;

      expectTypeOf<HasRpc>().toEqualTypeOf<true>();
      expectTypeOf<HasPublish>().toEqualTypeOf<true>();
    });

    it("preserves extensions through .onError()", () => {
      const router = createRouter()
        .plugin(mockValidation)
        .plugin(mockPubSub)
        .onError(() => {});

      // Extensions preserved after .onError()
      expectTypeOf(router).toHaveProperty("rpc");
      expectTypeOf(router).toHaveProperty("publish");
    });
  });

  describe("capability-gated APIs", () => {
    it("base router does NOT have rpc or publish", () => {
      type BaseRouter = Router<any, {}>;

      // No validation = no rpc
      type HasRpc = "rpc" extends keyof BaseRouter ? true : false;
      expectTypeOf<HasRpc>().toEqualTypeOf<false>();

      // No pubsub = no publish
      type HasPublish = "publish" extends keyof BaseRouter ? true : false;
      expectTypeOf<HasPublish>().toEqualTypeOf<false>();
    });

    it("validation marker enables ValidationAPI", () => {
      type ValidatedRouter = RouterWithExtensions<any, { validation: true }>;

      type HasRpc = "rpc" extends keyof ValidatedRouter ? true : false;
      expectTypeOf<HasRpc>().toEqualTypeOf<true>();
    });

    it("pubsub marker enables PubSubAPI", () => {
      type PubSubRouter = RouterWithExtensions<any, { pubsub: true }>;

      type HasPublish = "publish" extends keyof PubSubRouter ? true : false;
      expectTypeOf<HasPublish>().toEqualTypeOf<true>();

      type HasTopics = "topics" extends keyof PubSubRouter ? true : false;
      expectTypeOf<HasTopics>().toEqualTypeOf<true>();
    });

    it("both markers enable both APIs", () => {
      type FullRouter = RouterWithExtensions<
        any,
        { validation: true; pubsub: true }
      >;

      type HasRpc = "rpc" extends keyof FullRouter ? true : false;
      type HasPublish = "publish" extends keyof FullRouter ? true : false;

      expectTypeOf<HasRpc>().toEqualTypeOf<true>();
      expectTypeOf<HasPublish>().toEqualTypeOf<true>();
    });
  });

  describe("type narrowing", () => {
    it("RouterCore does not have capability-gated methods", () => {
      type HasRpc = "rpc" extends keyof RouterCore<any> ? true : false;
      type HasPublish = "publish" extends keyof RouterCore<any> ? true : false;

      expectTypeOf<HasRpc>().toEqualTypeOf<false>();
      expectTypeOf<HasPublish>().toEqualTypeOf<false>();
    });

    it("RouterWithExtensions with empty extensions equals Router", () => {
      type Empty = RouterWithExtensions<any, {}>;
      type Base = Router<any, {}>;

      // Should be structurally equivalent
      expectTypeOf<Empty>().toMatchTypeOf<Base>();
    });
  });

  describe("pubsub runtime API preservation", () => {
    // Mock pubsub plugin API matching the real withPubSub structure
    interface MockPubSubRuntime {
      tap: (observer: unknown) => () => void;
      init: () => Promise<void>;
      shutdown: () => Promise<void>;
    }

    interface RealPubSubAPI {
      __caps: { pubsub: true };
      pubsub: MockPubSubRuntime;
      publish: (
        topic: string,
        schema: MessageDescriptor,
        payload: unknown,
      ) => void;
      topics: { list: () => string[]; has: (t: string) => boolean };
    }

    const realPubSubPlugin: Plugin<any, RealPubSubAPI> = (router) =>
      Object.assign(router, {
        __caps: { pubsub: true } as const,
        pubsub: {
          tap: () => () => {},
          init: async () => {},
          shutdown: async () => {},
        },
        publish: () => {},
        topics: { list: () => [], has: () => false },
      }) as any;

    it("preserves pubsub runtime object after plugin application", () => {
      const router = createRouter().plugin(realPubSubPlugin);

      // PubSubAPI methods (from capability gate)
      expectTypeOf(router).toHaveProperty("publish");
      expectTypeOf(router).toHaveProperty("topics");

      // Runtime management API (from plugin return type) - was failing before fix
      expectTypeOf(router).toHaveProperty("pubsub");
      expectTypeOf(router.pubsub).toHaveProperty("tap");
      expectTypeOf(router.pubsub).toHaveProperty("init");
      expectTypeOf(router.pubsub).toHaveProperty("shutdown");
    });

    it("preserves pubsub runtime when chained with validation", () => {
      const router = createRouter()
        .plugin(mockValidation)
        .plugin(realPubSubPlugin);

      // Both APIs present
      expectTypeOf(router).toHaveProperty("rpc");
      expectTypeOf(router).toHaveProperty("publish");
      expectTypeOf(router).toHaveProperty("pubsub");
      expectTypeOf(router.pubsub).toHaveProperty("tap");
    });

    it("preserves pubsub runtime regardless of plugin order", () => {
      const router = createRouter()
        .plugin(realPubSubPlugin)
        .plugin(mockValidation);

      // Both APIs present regardless of order
      expectTypeOf(router).toHaveProperty("rpc");
      expectTypeOf(router).toHaveProperty("pubsub");
      expectTypeOf(router.pubsub.init).toBeFunction();
    });
  });

  describe("__caps capability gating", () => {
    it("detects capability via __caps marker", () => {
      // Modern: __caps: { pubsub: true }
      type ModernPubSub = RouterWithExtensions<
        any,
        { __caps: { pubsub: true } }
      >;

      type HasPublish = "publish" extends keyof ModernPubSub ? true : false;
      type HasTopics = "topics" extends keyof ModernPubSub ? true : false;

      expectTypeOf<HasPublish>().toEqualTypeOf<true>();
      expectTypeOf<HasTopics>().toEqualTypeOf<true>();
    });

    it("legacy boolean marker still works", () => {
      // Legacy: { pubsub: true }
      type LegacyPubSub = RouterWithExtensions<any, { pubsub: true }>;

      type HasPublish = "publish" extends keyof LegacyPubSub ? true : false;
      expectTypeOf<HasPublish>().toEqualTypeOf<true>();
    });

    it("__caps validation marker works", () => {
      type ModernValidation = RouterWithExtensions<
        any,
        { __caps: { validation: true } }
      >;

      type HasRpc = "rpc" extends keyof ModernValidation ? true : false;
      expectTypeOf<HasRpc>().toEqualTypeOf<true>();
    });
  });
});
