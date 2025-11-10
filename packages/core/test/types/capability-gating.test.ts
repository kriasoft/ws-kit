/**
 * Type-level tests: capability gating (TypeScript only).
 *
 * Scenarios:
 * - router.on() is always available (BaseRouter)
 * - router.rpc() is NOT available until validation plugin
 * - router.publish() is NOT available until pubsub plugin
 * - ctx.payload exists only after validation
 * - ctx.send(), ctx.reply(), ctx.progress() exist only in appropriate handlers
 *
 * Note: These tests use expectType-style assertions via TypeScript error checking.
 * Run with `bun tsc --noEmit` to verify types.
 */

import type { Router, MessageDescriptor, MinimalContext, EventContext, RpcContext } from "../../src/index";

describe("capability gating (types)", () => {
  // Test 1: BaseRouter without plugins has no rpc, publish, subscribe
  {
    const router: Router<{ userId: string }> = null as any;

    // @ts-expect-error rpc is not available without validation plugin
    router.rpc({} as MessageDescriptor & { response: MessageDescriptor }, (ctx) => {});

    // @ts-expect-error publish is not available without pubsub plugin
    router.publish("topic", {} as MessageDescriptor, {});
  }

  // Test 2: After validation plugin, rpc method is available
  {
    const withValidation = (r: Router<any>) => {
      const enhanced = Object.assign(r, {
        rpc: (schema: MessageDescriptor & { response: MessageDescriptor }, handler: any) => r,
      }) as Router<any, { validation: true }>;
      (enhanced as any).__caps = { validation: true };
      return enhanced;
    };

    const router: Router<{ userId: string }, { validation: true }> = null as any;

    // Should not error - rpc is available
    router.rpc({} as MessageDescriptor & { response: MessageDescriptor }, (ctx) => {});
  }

  // Test 3: After pubsub plugin, publish method is available
  {
    const withPubSub = (r: Router<any>) => {
      const enhanced = Object.assign(r, {
        publish: (topic: string, schema: MessageDescriptor, payload: unknown) => Promise.resolve(),
        subscriptions: { list: () => [], has: (topic: string) => false },
      }) as Router<any, { pubsub: true }>;
      (enhanced as any).__caps = { pubsub: true };
      return enhanced;
    };

    const router: Router<{ userId: string }, { pubsub: true }> = null as any;

    // Should not error - publish is available
    router.publish("topic", {} as MessageDescriptor, {});
  }

  // Test 4: Context enrichment - payload only after validation
  {
    // Without validation: no payload
    const ctxBase: MinimalContext<{ userId: string }> = null as any;
    // @ts-expect-error payload is not available on MinimalContext
    ctxBase.payload;

    // With validation: payload available
    const ctxEvent: EventContext<{ userId: string }, { name: string }> = null as any;
    const payload: { name: string } = ctxEvent.payload;

    const ctxRpc: RpcContext<{ userId: string }, { id: string }, { success: boolean }> = null as any;
    const rpcPayload: { id: string } = ctxRpc.payload;
  }

  // Test 5: send() only available in event context
  {
    const ctxEvent: EventContext<{ userId: string }, any> = null as any;
    // Should not error - send is available
    ctxEvent.send({} as MessageDescriptor, {});

    // reply and progress not available on event context
    // @ts-expect-error reply is not available on EventContext
    ctxEvent.reply({});

    // @ts-expect-error progress is not available on EventContext
    ctxEvent.progress({});
  }

  // Test 6: reply() and progress() only available in RPC context
  {
    const ctxRpc: RpcContext<{ userId: string }, any, any> = null as any;

    // Should not error - reply and progress are available
    ctxRpc.reply({});
    ctxRpc.progress({});

    // @ts-expect-error send is not available on RpcContext
    ctxRpc.send({} as MessageDescriptor, {});
  }

  // Test 7: Fluent chaining preserves types
  {
    const withValidation = (r: Router<any>) => {
      const enhanced = Object.assign(r, {
        rpc: (schema: MessageDescriptor & { response: MessageDescriptor }, handler: any) => enhanced,
      }) as Router<any, { validation: true }>;
      (enhanced as any).__caps = { validation: true };
      return enhanced;
    };

    const router: Router<{ userId: string }> = null as any;
    const withValidated = withValidation(router);

    // Type is preserved through chaining
    withValidated.rpc({} as MessageDescriptor & { response: MessageDescriptor }, (ctx) => {});
    withValidated.on({} as MessageDescriptor, (ctx) => {});
    withValidated.use(async (ctx, next) => {
      await next();
    });
  }
});
