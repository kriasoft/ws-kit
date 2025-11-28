// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Type-level tests: PubSub router narrowing and capability gating
 *
 * Mirrors the validation type tests to ensure pubsub capability gating works.
 *
 * Scenarios:
 * - Router without pubsub plugin does NOT have publish() in keyof
 * - Router with withPubSub() HAS publish() and topics in keyof
 * - Capability gating prevents misuse at compile-time
 *
 * Run with: `bun tsc --noEmit` or `bun test`
 */

import type { Router } from "@ws-kit/core";
import { createRouter } from "@ws-kit/core";
import { memoryPubSub } from "@ws-kit/memory";
import { withZod } from "@ws-kit/zod";
import { describe, expectTypeOf, it } from "bun:test";
import { withPubSub } from "./plugin.js";

describe("pubsub plugin narrowing - types", () => {
  // Test 1: Router without plugin has NO publish() method
  it("router without plugin should NOT have publish", () => {
    // Type assertion: Router without plugins should not have publish
    type BaseRouter = Router<{ userId?: string }>;
    type HasPublish = "publish" extends keyof BaseRouter ? true : false;

    expectTypeOf<HasPublish>().toEqualTypeOf<false>();
  });

  // Test 2: Router without plugin has NO topics
  it("router without plugin should NOT have topics", () => {
    type BaseRouter = Router<{ userId?: string }>;
    type HasTopics = "topics" extends keyof BaseRouter ? true : false;

    expectTypeOf<HasTopics>().toEqualTypeOf<false>();
  });

  // Test 3: withPubSub() returns Router with pubsub capability
  it("withPubSub() plugin narrows router to pubsub capability", () => {
    type PublisherRouter = ReturnType<ReturnType<typeof withPubSub>>;

    expectTypeOf<PublisherRouter>().toHaveProperty("publish");
    expectTypeOf<PublisherRouter>().toHaveProperty("topics");
  });

  // Test 4: Router.plugin(withPubSub()) returns publisher router
  it("router.plugin(withPubSub()) provides publish and topics methods", () => {
    const publisher = createRouter<{ userId?: string }>().plugin(
      withPubSub({ adapter: memoryPubSub() }),
    );

    // Should have pubsub methods
    expectTypeOf(publisher).toHaveProperty("publish");
    expectTypeOf(publisher).toHaveProperty("topics");

    // Should still have base methods
    expectTypeOf(publisher).toHaveProperty("on");
    expectTypeOf(publisher).toHaveProperty("use");
    expectTypeOf(publisher).toHaveProperty("onError");
  });

  // Test 5: Fluent chaining preserves pubsub capability
  it("fluent chaining preserves pubsub capability", () => {
    const publisher = createRouter<{ userId?: string }>()
      .plugin(withPubSub({ adapter: memoryPubSub() }))
      .use(async (ctx, next) => {
        await next();
      });

    // Type is preserved - publish() available after chaining
    expectTypeOf(publisher).toHaveProperty("publish");
    expectTypeOf(publisher).toHaveProperty("topics");
    expectTypeOf(publisher).toHaveProperty("on");
  });

  // Test 6: withPubSub() is idempotent
  it("withPubSub() plugin is idempotent", () => {
    const router = createRouter<{ userId?: string }>();
    const withPubSubPlugin = withPubSub({ adapter: memoryPubSub() });

    const publisher1 = router.plugin(withPubSubPlugin);
    const publisher2 = publisher1.plugin(withPubSubPlugin);

    // Type should be same after both applications
    expectTypeOf(publisher1).toHaveProperty("publish");
    expectTypeOf(publisher2).toHaveProperty("publish");
  });

  // Test 7: withZod + withPubSub preserves validation capability
  it("keeps rpc() available after chaining withPubSub()", () => {
    const router = createRouter()
      .plugin(withZod())
      .plugin(withPubSub({ adapter: memoryPubSub() }));

    expectTypeOf(router).toHaveProperty("publish");
    expectTypeOf(router).toHaveProperty("rpc");
  });
});
