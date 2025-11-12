// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Test harness: createTestRouter and wrapTestRouter implementations.
 * Provides a clean, ergonomic testing API for WS-Kit routers.
 */

import { TestPubSub } from "@ws-kit/pubsub/internal";
import type { BaseContextData } from "../context/base-context";
import type { CoreRouter, Router } from "../core/router";
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
export interface CreateTestRouterOptions<TContext> {
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
export function createTestRouter<TContext extends BaseContextData = unknown>(
  opts?: CreateTestRouterOptions<TContext>,
): TestRouter<TContext> {
  // Create the router
  if (!opts?.create) {
    throw new Error(
      "createTestRouter requires a create() function. Example: createTestRouter({ create: () => createRouter() })",
    );
  }
  const router = opts.create();

  // Apply plugins
  let configuredRouter = router;
  if (opts?.plugins) {
    for (const plugin of opts.plugins) {
      configuredRouter = plugin(configuredRouter);
    }
  }

  // Wrap with test infrastructure
  return wrapTestRouter(configuredRouter, {
    clock: opts?.clock,
    onErrorCapture: opts?.onErrorCapture !== false,
  });
}

/**
 * Wrap an existing router with test infrastructure.
 * Useful for testing production routers in black-box mode.
 */
export function wrapTestRouter<TContext extends BaseContextData = unknown>(
  router: Router<TContext>,
  opts?: { clock?: Clock; onErrorCapture?: boolean },
): TestRouter<TContext> {
  // Cast to internal implementation to access registry, lifecycle, etc.
  const impl = router as any as CoreRouter<TContext>;

  // Infrastructure
  const adapter = new InMemoryPlatformAdapter<TContext>(impl);
  const clock = opts?.clock || new FakeClock();
  const capturedErrors: unknown[] = [];
  const connections = new Map<string, TestConnectionImpl<TContext>>();

  // Optionally enable error capture
  if (opts?.onErrorCapture !== false) {
    router.onError((err) => {
      capturedErrors.push(err);
    });
  }

  // If PubSub is present, wrap it
  let pubsubAdapter: TestPubSub | undefined;
  // Note: We can't easily detect if pubsub is enabled at this point.
  // This will be handled by checking capabilities dynamically.

  // Create TestCapture implementation
  const capture: TestCapture<TContext> = {
    errors(): readonly unknown[] {
      return capturedErrors;
    },
    publishes(): readonly PublishRecord[] {
      return pubsubAdapter?.getPublishedMessages() || [];
    },
    messages(): readonly OutgoingFrame[] {
      return adapter.getAllSentMessages();
    },
    clear(): void {
      capturedErrors.length = 0;
      pubsubAdapter?.clearPublished();
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

    // Initialize router's data store with the adapter's initial data.
    // This ensures context.data contains the connection data passed to connect().
    if (state.data && Object.keys(state.data).length > 0) {
      // Use cast to access private method (testing-only)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const routerData = (impl as any).getOrInitData(ws);
      Object.assign(routerData, state.data);
    }

    // Wire the websocket bridge to exercise the same lifecycle as real adapters.
    // This ensures plugins' onConnect hooks fire and initialization happens.
    void impl.websocket.open(ws);

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
  const testRouter = Object.assign(router, {
    connect(init?: {
      data?: Partial<TContext>;
      headers?: Record<string, string>;
    }): TestConnection<TContext> {
      // Generate a unique client ID
      const clientId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return getOrCreateConnection(clientId, init);
    },

    capture,
    clock,

    async tick(ms: number): Promise<void> {
      if (clock instanceof FakeClock) {
        await clock.tick(ms);
      }
    },

    async flush(): Promise<void> {
      // Wait for all pending messages to complete
      for (const [, conn] of connections) {
        await conn.waitForPendingMessages();
      }
      // Then wait for microtasks and clock
      await clock.now();
      await new Promise((resolve) => setImmediate(resolve));
    },

    async close(): Promise<void> {
      // Close all connections
      adapter.closeAll();

      // Check for leaked timers
      if (clock instanceof FakeClock) {
        const pending = clock.pendingTimers();
        if (pending.length > 0) {
          console.warn(
            `[Test] Leaked ${pending.length} timers after close:`,
            pending,
          );
        }
      }
    },
  }) as any as TestRouter<TContext>;

  return testRouter;
}

/**
 * Implementation of TestConnection.
 */
class TestConnectionImpl<TContext extends BaseContextData = unknown>
  implements TestConnection<TContext>
{
  private outgoingFrames: OutgoingFrame[] = [];
  private pendingMessages: Promise<void>[] = [];

  constructor(
    readonly clientId: string,
    readonly ws: any, // MockWebSocket
    readonly state: any, // ConnectionState<TContext>
    readonly routerImpl: any, // CoreRouter<TContext>
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
    await new Promise((resolve) => setImmediate(resolve));
  }

  subscriptions(): readonly string[] {
    return Array.from(this.state.subscriptions);
  }

  getData(): Readonly<TContext> {
    return Object.freeze({ ...this.state.data });
  }

  setData(patch: Partial<TContext>): void {
    Object.assign(this.state.data, patch);
  }

  async close(): Promise<void> {
    // Route through websocket bridge to ensure cleanup hooks fire.
    // This invokes router.websocket.close(), which notifies lifecycle
    // handlers and plugins about connection termination.
    await this.routerImpl.websocket.close(this.ws);
  }
}
