/**
 * Test harness: createTestRouter and wrapTestRouter implementations.
 * Provides a clean, ergonomic testing API for WS-Kit routers.
 */

import type { Router } from "../core/types";
import type { MinimalContext, BaseContextData } from "../context/base-context";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import { FakeClock, type Clock } from "./fake-clock";
import { MockPlatformAdapter } from "./test-adapter";
import { TestPubSub } from "@ws-kit/pubsub/internal";
import type {
  TestRouter,
  TestConnection,
  OutboundFrame,
  PublishedFrame,
  TestCapture,
} from "./types";
import { dispatch, dispatchMessage } from "../engine/dispatch";
import type { CoreRouter } from "../core/router";

/**
 * Test harness options.
 */
export interface CreateTestRouterOptions<TConn> {
  /**
   * Router factory (default: createRouter with no options).
   */
  create?: () => Router<TConn>;

  /**
   * Plugins to apply after creating the router.
   */
  plugins?: ((router: Router<TConn, any>) => Router<TConn, any>)[];

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
export function createTestRouter<TConn extends BaseContextData = unknown>(
  opts?: CreateTestRouterOptions<TConn>,
): TestRouter<TConn> {
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
export function wrapTestRouter<TConn extends BaseContextData = unknown>(
  router: Router<TConn>,
  opts?: { clock?: Clock; onErrorCapture?: boolean },
): TestRouter<TConn> {
  // Cast to internal implementation to access registry, lifecycle, etc.
  const impl = router as any as CoreRouter<TConn>;

  // Infrastructure
  const adapter = new MockPlatformAdapter<TConn>();
  const clock = opts?.clock || new FakeClock();
  const capturedErrors: unknown[] = [];
  const connections = new Map<string, TestConnectionImpl<TConn>>();

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
  const capture: TestCapture<TConn> = {
    errors(): readonly unknown[] {
      return capturedErrors;
    },
    publishes(): readonly PublishedFrame[] {
      return pubsubAdapter?.getPublishedMessages() || [];
    },
    messages(): readonly OutboundFrame[] {
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
    init?: { data?: Partial<TConn>; headers?: Record<string, string> },
  ): TestConnectionImpl<TConn> {
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
  const testRouter = Object.assign(router, {
    connect(init?: {
      data?: Partial<TConn>;
      headers?: Record<string, string>;
    }): TestConnection<TConn> {
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
      await clock.now(); // Ensure clock has method
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
  }) as any as TestRouter<TConn>;

  return testRouter;
}

/**
 * Implementation of TestConnection.
 */
class TestConnectionImpl<TConn extends BaseContextData = unknown>
  implements TestConnection<TConn>
{
  private outgoingFrames: OutboundFrame[] = [];

  constructor(
    readonly clientId: string,
    readonly ws: any, // MockWebSocket
    readonly state: any, // ConnectionState<TConn>
    readonly routerImpl: any, // CoreRouter<TConn>
    readonly adapter: MockPlatformAdapter<TConn>,
    readonly clock: Clock,
  ) {}

  send(type: string, payload?: unknown, meta?: Record<string, unknown>): void {
    // Create a JSON frame and dispatch it through the full pipeline
    const frame = JSON.stringify({ type, payload, meta });
    void dispatchMessage(frame, this.ws, this.routerImpl);
  }

  outgoing(): readonly OutboundFrame[] {
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

  getData(): Readonly<TConn> {
    return Object.freeze({ ...this.state.data });
  }

  setData(patch: Partial<TConn>): void {
    Object.assign(this.state.data, patch);
  }

  async close(): Promise<void> {
    this.adapter.close(this.clientId);
  }
}
