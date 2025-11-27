// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Test harness: createTestRouter and wrapTestRouter implementations.
 * Provides a clean, ergonomic testing API for WS-Kit routers.
 */

import type { ConnectionData } from "../context/base-context";
import type { Router } from "../core/router";
import type {
  PublishOptions,
  PublishResult,
  RouterObserver,
} from "../core/types";
import type { RouterImpl } from "../internal";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import { FakeClock, type Clock } from "./fake-clock";
import { InMemoryPlatformAdapter } from "./test-adapter";
import type {
  OutgoingFrame,
  PublishRecord,
  TestCapture,
  TestConnection,
  TestRouter,
} from "./types";

/**
 * Test harness options.
 */
export interface CreateTestRouterOptions<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Router factory (default: createRouter with no options).
   */
  create?: () => Router<TContext>;

  /**
   * Plugins to apply after creating the router.
   */
  plugins?: ((router: Router<TContext, any>) => Router<TContext, any>)[];

  /**
   * Clock implementation (default: FakeClock for determinism).
   */
  clock?: Clock;

  /**
   * Enable automatic error capture via onError (default: true).
   */
  onErrorCapture?: boolean;

  /**
   * Capture pub/sub publishes (if pub/sub is enabled).
   * This automatically taps into the pub/sub observer to capture publish records.
   * Default: true.
   */
  capturePubSub?: boolean;

  /**
   * Strict mode: fail on timer leaks instead of warn (default: false).
   * Useful in CI to catch unclosed RPCs and other timer-based bugs.
   */
  strict?: boolean;
}

/**
 * Create a test router for convenient testing.
 *
 * Example:
 * ```ts
 * const tr = createTestRouter({
 *   create: () => createRouter().plugin(withZod()),
 * });
 *
 * const conn = tr.connect({ data: { userId: "u1" } });
 * conn.send("PING", { text: "hello" });
 * await tr.flush();
 * expect(conn.outgoing()).toContainEqual({ type: "PONG", ... });
 * ```
 */
export function createTestRouter<
  TContext extends ConnectionData = ConnectionData,
>(opts?: CreateTestRouterOptions<TContext>): TestRouter<TContext> {
  // Create the router
  if (!opts?.create) {
    throw new Error(
      "createTestRouter requires a create() function. Example: createTestRouter({ create: () => createRouter() })",
    );
  }
  const router = opts.create();

  // Apply plugins
  let configuredRouter: Router<TContext, any> = router;
  if (opts?.plugins) {
    for (const plugin of opts.plugins) {
      configuredRouter = plugin(configuredRouter);
    }
  }

  // Wrap with test infrastructure
  const testOpts: {
    clock?: Clock;
    onErrorCapture?: boolean;
    capturePubSub?: boolean;
    strict?: boolean;
  } = {
    onErrorCapture: opts?.onErrorCapture !== false,
    capturePubSub: opts?.capturePubSub !== false,
  };
  if (opts?.clock !== undefined) {
    testOpts.clock = opts.clock;
  }
  if (opts?.strict !== undefined) {
    testOpts.strict = opts.strict;
  }
  return wrapTestRouter(configuredRouter, testOpts);
}

/**
 * Wrap an existing router with test infrastructure.
 * Useful for testing production routers in black-box mode.
 */
export function wrapTestRouter<
  TContext extends ConnectionData = ConnectionData,
>(
  router: Router<TContext, any>,
  opts?: {
    clock?: Clock;
    onErrorCapture?: boolean;
    capturePubSub?: boolean;
    strict?: boolean;
  },
): TestRouter<TContext> {
  // Get router implementation for internal access (needed for test adapter)
  // This is the only place we cast to internal RouterImpl type for test adapter setup
  const impl = router as any as RouterImpl<TContext>;

  // Infrastructure
  // Note: InMemoryPlatformAdapter needs internal access to RouterImpl
  const adapter = new InMemoryPlatformAdapter<TContext>(impl);
  const clock = opts?.clock || new FakeClock();
  const capturedErrors: unknown[] = [];
  const connections = new Map<string, TestConnectionImpl<TContext>>();
  const capturedPublishes: PublishRecord[] = [];
  const unsubscribers: (() => void)[] = [];

  // Register router observer (no casting required for this API)
  // This replaces the previous pubsub.tap() approach with a public, composable API
  const observerConfig: Partial<RouterObserver<TContext>> = {};

  // Only capture publishes if enabled
  if (opts?.capturePubSub !== false) {
    observerConfig.onPublish = (rec) => {
      capturedPublishes.push(rec);
    };
  }

  // Always capture errors (unless disabled)
  if (opts?.onErrorCapture !== false) {
    observerConfig.onError = (err) => {
      capturedErrors.push(err);
    };
  }

  const unsubscribe = router.observe(observerConfig);
  unsubscribers.push(unsubscribe);

  // Create TestCapture implementation
  const capture: TestCapture<TContext> = {
    errors(): readonly unknown[] {
      return capturedErrors;
    },
    assertErrors(): readonly Error[] {
      return capturedErrors.filter((err) => err instanceof Error) as Error[];
    },
    publishes(): readonly PublishRecord[] {
      return capturedPublishes;
    },
    messages(): readonly OutgoingFrame[] {
      return adapter.getAllSentMessages();
    },
    clear(): void {
      capturedErrors.length = 0;
      capturedPublishes.length = 0;
      adapter.clearSentMessages();
      for (const [, conn] of connections) {
        conn.clearOutgoing();
      }
    },
  };

  // Helper to get/create a TestConnection
  function getOrCreateConnection(
    clientId: string,
    init?: { data?: Partial<TContext>; headers?: Record<string, string> },
  ): TestConnectionImpl<TContext> {
    let conn = connections.get(clientId);
    if (conn) {
      return conn;
    }

    const ws = adapter.getOrCreateConnection(init) as any;
    const actualClientId = ws.clientId;
    const state = adapter.getConnection(actualClientId)!;

    conn = new TestConnectionImpl(
      actualClientId,
      ws,
      state,
      impl,
      adapter,
      clock,
    );
    connections.set(clientId, conn);
    return conn;
  }

  // Build the TestRouter by mixing router + test methods
  const publish = (router as any).publish?.bind(router);
  const testRouter = Object.assign(router, {
    async publish(
      topic: string,
      schema: MessageDescriptor,
      payload: unknown,
      options?: PublishOptions,
    ): Promise<PublishResult> {
      if (typeof publish !== "function") {
        throw new Error(
          "router.publish is not available (did you plug in pub/sub?)",
        );
      }
      return publish(topic, schema, payload, options);
    },

    async connect(init?: {
      data?: Partial<TContext>;
      headers?: Record<string, string>;
    }): Promise<TestConnection<TContext>> {
      // Generate a unique client ID
      const clientId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const conn = getOrCreateConnection(clientId, init);
      // Wire the websocket bridge and wait for initialization to complete.
      // This ensures plugins' onConnect hooks fire before any messages are sent.
      // Use public router.websocket API (no cast needed)
      await router.websocket.open(conn.ws);
      return conn;
    },

    getConnectionInfo(clientId: string) {
      const info = adapter.getConnectionInfo(clientId);
      return {
        headers: info.headers,
      };
    },

    capture,
    clock,

    async tick(ms: number): Promise<void> {
      if (clock instanceof FakeClock) {
        await clock.tick(ms);
      }
    },

    async flush(): Promise<void> {
      // Wait for all pending messages to complete.
      // Note: connect() already awaits open(), so no need to wait for that here.
      for (const [, conn] of connections) {
        await conn.waitForPendingMessages();
      }
      // Flush microtasks through the clock API
      if (clock instanceof FakeClock) {
        await clock.flush();
      } else {
        await Promise.resolve();
      }
    },

    async close(): Promise<void> {
      // Unsubscribe from observers
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }

      // Close all connections
      adapter.closeAll();

      // Check for leaked timers
      if (clock instanceof FakeClock) {
        const pending = clock.pendingTimers();
        if (pending.length > 0) {
          const msg = `Leaked ${pending.length} timers after close: ${JSON.stringify(pending)}`;
          if (opts?.strict) {
            throw new Error(`[Test] Timer leaks detected: ${msg}`);
          } else {
            console.warn(`[Test] ${msg}`);
          }
        }
      }
    },
  }) as any as TestRouter<TContext>;

  return testRouter;
}

/**
 * Implementation of TestConnection.
 */
class TestConnectionImpl<
  TContext extends ConnectionData = ConnectionData,
> implements TestConnection<TContext> {
  private outgoingFrames: OutgoingFrame[] = [];
  private pendingMessages: Promise<void>[] = [];

  constructor(
    readonly clientId: string,
    readonly ws: any, // MockWebSocket
    readonly state: any, // ConnectionState<TContext>
    readonly routerImpl: any, // RouterImpl<TContext>
    readonly adapter: InMemoryPlatformAdapter<TContext>,
    readonly clock: Clock,
  ) {}

  send(type: string, payload?: unknown, meta?: Record<string, unknown>): void {
    // Route through adapter to exercise the websocket bridge.
    // This ensures messages flow through router.websocket.message(),
    // same as production adapters.
    // Fire-and-forget; track pending operation for flush().
    const pending = this.adapter.receiveMessage(
      this.clientId,
      type,
      payload,
      meta,
    );
    this.pendingMessages.push(pending);
    // Clean up when done
    void pending.then(() => {
      const idx = this.pendingMessages.indexOf(pending);
      if (idx >= 0) this.pendingMessages.splice(idx, 1);
    });
  }

  /**
   * Wait for all pending message operations to complete.
   */
  async waitForPendingMessages(): Promise<void> {
    while (this.pendingMessages.length > 0) {
      await Promise.all(this.pendingMessages);
    }
  }

  outgoing(): readonly OutgoingFrame[] {
    // Combine frames sent directly to this WS with those captured by the adapter
    return this.ws.getSentMessages();
  }

  clearOutgoing(): void {
    this.ws.clearSentMessages();
  }

  async drain(): Promise<void> {
    // Flush microtasks through the clock API
    if (this.clock instanceof FakeClock) {
      await this.clock.flush();
    } else {
      await Promise.resolve();
    }
  }

  subscriptions(): readonly string[] {
    return Array.from(this.state.subscriptions);
  }

  getData(): Readonly<TContext> {
    return Object.freeze({ ...this.state.data });
  }

  assignData(patch: Partial<TContext>): void {
    Object.assign(this.state.data, patch);
  }

  async close(): Promise<void> {
    // Route through websocket bridge to ensure cleanup hooks fire.
    // This invokes router.websocket.close(), which notifies lifecycle
    // handlers and plugins about connection termination.
    await this.routerImpl.websocket.close(this.ws);
  }
}
