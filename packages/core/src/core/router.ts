// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * RouterCore implementation.
 *
 * Public methods:
 * - use(mw) → Global middleware
 * - on(schema, handler) → Event handler (kind="event")
 * - rpc(schema, handler) → RPC handler (kind="rpc") [added by validation plugin]
 * - route(schema) → Per-route builder (fluent)
 * - merge(router, opts) → Combine routers (with conflict resolution)
 * - mount(prefix, router, opts) → Prefix schema types
 * - plugin(fn) → Widening capability host
 * - onError(fn) → Universal error sink
 *
 * Capability-gated: rpc(), publish(), subscribe() exist only when plugins add them.
 */

import type { ConnectionData, MinimalContext } from "../context/base-context";
import { dispatchMessage } from "../engine/dispatch";
import { LifecycleManager } from "../engine/lifecycle";
import { LimitsManager } from "../engine/limits-manager";
import { PluginHost } from "../plugin/manager";
import type { Plugin } from "../plugin/types";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import type { ServerWebSocket } from "../ws/platform-adapter";
import { RouteTable } from "./route-table";
import { ROUTE_TABLE, ROUTER_IMPL } from "./symbols";
import type {
  CreateRouterOptions,
  EventHandler,
  Middleware,
  PublishCapability,
  PublishError,
  PublishOptions,
  PublishRecord,
  PublishResult,
  RouteEntry,
  RouterObserver,
} from "./types";

export type { PublishCapability, PublishError, PublishOptions, PublishResult };

export interface RouterCore<TContext extends ConnectionData = ConnectionData> {
  use(mw: Middleware<TContext>): this;
  on(schema: MessageDescriptor, handler: EventHandler<TContext>): this;
  route(schema: MessageDescriptor): RouteBuilder<TContext>;
  merge(
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this;
  mount(
    prefix: string,
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this;
  plugin<P extends Plugin<TContext>>(plugin: P): ReturnType<P>;
  onError(
    fn: (err: unknown, ctx: MinimalContext<TContext> | null) => void,
  ): this;

  /**
   * Observe key lifecycle events for testing and monitoring plugins.
   *
   * Callbacks are called synchronously in registration order. Exceptions are logged
   * and swallowed to prevent one bad observer from affecting others. Re-entrancy
   * is safe (observer list is snapshotted at dispatch time).
   *
   * @param observer Partial observer with optional hooks
   * @returns Unsubscribe function for cleanup
   *
   * @example
   * ```typescript
   * const off = router.observe({
   *   onPublish: (rec) => console.log(`Published to ${rec.topic}`),
   *   onError: (err) => console.error(`Error: ${err.message}`),
   * });
   * // ... later, unsubscribe:
   * off();
   * ```
   */
  observe(observer: Partial<RouterObserver<TContext>>): () => void;

  /**
   * Platform-agnostic WebSocket handler interface.
   *
   * Provides the contract for platform adapters (Bun, Cloudflare, Node.js, etc.)
   * to delegate WebSocket lifecycle events to the router.
   *
   * @example
   * ```typescript
   * // In adapter handler
   * const { fetch, websocket } = createBunHandler(router);
   * // Internally calls: router.websocket.open(ws), router.websocket.message(ws, data), etc.
   * ```
   */
  readonly websocket: {
    open(ws: ServerWebSocket): Promise<void>;
    message(ws: ServerWebSocket, data: string | ArrayBuffer): Promise<void>;
    close(ws: ServerWebSocket, code?: number, reason?: string): Promise<void>;
  };
}

/**
 * Router<TContext, TExtensions> = RouterCore + structural extensions.
 *
 * TExtensions is an object type representing all APIs added by plugins.
 * Plugins use definePlugin<TContext, TPluginApi> to add their extensions.
 * Type is automatically widened: each .plugin(p) call intersects new APIs.
 *
 * @example
 * ```typescript
 * // After withZod:
 * Router<MyContext, { rpc(...): this }>
 *
 * // After withPubSub:
 * Router<MyContext, { rpc(...): this } & { publish(...): Promise<PublishResult> }>
 * ```
 */
export type Router<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> = RouterCore<TContext> & TExtensions;

/**
 * Validation API appears when withZod() or withValibot() is plugged.
 * Only addition: rpc() method (on() already exists in base).
 * TContext is kept for type alignment with other API interfaces.
 */

export interface ValidationAPI<
  TContext extends ConnectionData = ConnectionData,
> {
  rpc(
    schema: MessageDescriptor & { response: MessageDescriptor },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: any, // RpcHandler<TContext> (inferred by validation plugin)
  ): this;
}

/**
 * Pub/Sub API appears when withPubSub() is plugged.
 *
 * Enables publish-subscribe messaging with the following contract:
 * - `publish()` returns a `PublishResult` discriminated union (never throws for runtime errors)
 * - `topics` provides introspection and subscription management
 *
 * @see {@link PublishResult} for detailed success/failure semantics
 * @see {@link PublishOptions} for publish configuration options
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface PubSubAPI<TContext extends ConnectionData = ConnectionData> {
  /**
   * Publish a message to a topic, optionally to multiple subscribers.
   *
   * **Never throws for runtime conditions.** All expected failures (validation, ACL denial,
   * backpressure, connection closed) return `{ok: false}` with an error code and `retryable` hint,
   * enabling predictable result-based error handling. Only programmer errors at startup throw.
   *
   * **Success** returns a discriminated union with `ok: true`:
   * - `capability`: Trust level of the subscriber count ("exact", "estimate", or "unknown")
   * - `matched?`: Subscriber count (omitted if capability is "unknown")
   *
   * **Failure** returns a discriminated union with `ok: false`:
   * - `error`: Canonical error code ("VALIDATION", "ACL_PUBLISH", "BACKPRESSURE", etc.)
   * - `retryable`: Whether safe to retry with backoff (true for BACKPRESSURE, CONNECTION_CLOSED, etc.)
   * - `adapter?`: Name of adapter that rejected (e.g., "redis", "inmemory")
   * - `details?`: Structured context (e.g., `{ feature: "excludeSelf" }` for UNSUPPORTED)
   * - `cause?`: Underlying error cause, following Error.cause conventions
   *
   * **Error Remediation:**
   * - Non-retryable (VALIDATION, ACL_PUBLISH, PAYLOAD_TOO_LARGE, UNSUPPORTED, STATE):
   *   Log and skip; fix the code/config before retrying.
   * - Retryable (BACKPRESSURE, CONNECTION_CLOSED, ADAPTER_ERROR):
   *   Queue for retry with exponential backoff; check `details.transient` for hints.
   *
   * @param topic — Topic name (e.g., "chat:room:123"). Must exist in topics.list() or be created via topics.subscribe().
   * @param schema — Message descriptor for type inference and validation.
   * @param payload — Message payload. Will be validated against schema if validation plugin is active.
   * @param opts — Optional publish configuration (partitionKey for sharding, excludeSelf, meta).
   *
   * @returns `PublishResult` discriminated union describing success or failure.
   *
   * @example
   * ```ts
   * const result = await ctx.publish("chat:room:1", ChatMessage, { text: "hello" });
   *
   * if (result.ok) {
   *   console.log(`Delivered to ${result.matched ?? "?"} subscribers (${result.capability})`);
   * } else if (result.retryable) {
   *   // Transient: queue for retry
   *   retryQueue.push({ topic: "chat:room:1", payload: { text: "hello" } });
   * } else {
   *   // Permanent: log and skip
   *   logger.error(`Publish failed: ${result.error}`, result.details);
   * }
   * ```
   *
   * @see {@link PublishOptions} for configuration details
   * @see {@link PublishError} for error codes and remediation
   * @see {@link PublishCapability} for subscriber count trust levels
   */
  publish(
    topic: string,
    schema: MessageDescriptor,
    payload: unknown,
    opts?: PublishOptions,
  ): Promise<PublishResult>;

  /**
   * Topic introspection and subscription management.
   *
   * Allows handlers to inspect active topics, subscribe to new ones, and unsubscribe.
   */
  topics: {
    /**
     * Get all active topic names for this connection.
     */
    list(): readonly string[];

    /**
     * Check if this connection is subscribed to a topic.
     */
    has(topic: string): boolean;
  };
}

/**
 * Per-route builder (fluent interface):
 *   router.route(schema).use(mw).use(mw2).on(handler)
 */
export interface RouteBuilder<
  TContext extends ConnectionData = ConnectionData,
> {
  use(mw: Middleware<TContext>): this;
  on(handler: EventHandler<TContext>): void;
}

/**
 * Read-only route index for plugins.
 * Plugins only need schema lookups; they should never mutate routes.
 * @internal
 */
export interface ReadonlyRouteIndex {
  get(type: string): { schema: MessageDescriptor } | undefined;
  has(type: string): boolean;
  list(): readonly { type: string; schema: MessageDescriptor }[];
}

/**
 * Extract a read-only route index from a router.
 * This is the preferred way for plugins to access schema lookups.
 * Uses the internal symbol to work across bundle boundaries.
 * @internal
 */
export function getRouteIndex(router: Router<any>): ReadonlyRouteIndex {
  // Extract RouteTable via symbol (works across bundle boundaries)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractor = (router as any)[ROUTE_TABLE];
  if (typeof extractor !== "function") {
    throw new Error(
      "Cannot extract route index: router does not expose internal route table symbol",
    );
  }
  const table = extractor.call(router) as RouteTable<any>;

  // Wrap RouteTable in read-only interface, exposing only schema metadata
  return {
    get: (type) => {
      const entry = table.get(type);
      return entry ? { schema: entry.schema } : undefined;
    },
    has: (type) => table.has(type),
    list: () =>
      table.list().map(([type, entry]) => ({ type, schema: entry.schema })),
  };
}

/**
 * Per-route builder implementation.
 * Accumulates middleware for a single message type, then registers with router.
 * @internal
 */
class RouteBuilderImpl<TContext extends ConnectionData = ConnectionData>
  implements RouteBuilder<TContext>
{
  private middlewares: Middleware<TContext>[] = [];

  constructor(
    private router: RouterImpl<TContext>,
    private schema: MessageDescriptor,
  ) {}

  use(mw: Middleware<TContext>): this {
    this.middlewares.push(mw);
    return this;
  }

  on(handler: EventHandler<TContext>): void {
    const entry: RouteEntry<TContext> = {
      schema: this.schema,
      middlewares: this.middlewares,
      handler,
    };
    this.router.registerRoute(entry);
  }
}

/**
 * RouterImpl implementation.
 * Stores global middleware, per-route handlers (via registry), and error hooks.
 * @internal
 */
export class RouterImpl<TContext extends ConnectionData = ConnectionData>
  implements RouterCore<TContext>
{
  private globalMiddlewares: Middleware<TContext>[] = [];
  private routes = new RouteTable<TContext>();
  private lifecycle = new LifecycleManager<TContext>();
  private limitsManager: LimitsManager;
  private pluginHost: PluginHost<TContext>;
  private connData = new WeakMap<ServerWebSocket, TContext>();
  private wsToClientId = new WeakMap<ServerWebSocket, string>();
  private observers: RouterObserver<TContext>[] = [];
  private _wsBridge:
    | {
        open(ws: ServerWebSocket): Promise<void>;
        message(ws: ServerWebSocket, data: string | ArrayBuffer): Promise<void>;
        close(
          ws: ServerWebSocket,
          code?: number,
          reason?: string,
        ): Promise<void>;
      }
    | undefined;

  constructor(private limitsConfig?: CreateRouterOptions["limits"]) {
    this.limitsManager = new LimitsManager(limitsConfig);
    // Initialize plugin host with self reference (cast to bypass recursive type)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pluginHost = new PluginHost<TContext>(this as any as Router<TContext>);
    // Attach to symbol for internal access escape hatch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)[ROUTER_IMPL] = this;
  }

  /**
   * Platform-agnostic WebSocket handler interface.
   *
   * Used by adapters (Bun, Cloudflare, Node.js) to delegate connection
   * lifecycle events to the router. This decouples the router from
   * specific platform APIs while providing a consistent contract.
   *
   * **Usage** (in adapter handlers):
   * ```ts
   * const handler = {
   *   async open(ws) { await router.websocket.open(ws); },
   *   async message(ws, data) { await router.websocket.message(ws, data); },
   *   async close(ws, code, reason) { await router.websocket.close(ws, code, reason); }
   * };
   * ```
   *
   * Memoized for zero-overhead access (bridge created once per router instance).
   *
   * @internal
   */
  get websocket() {
    return (this._wsBridge ??= {
      open: (ws: ServerWebSocket) => this.handleOpen(ws),
      message: (ws: ServerWebSocket, data: string | ArrayBuffer) =>
        this.handleMessage(ws, data),
      close: (ws: ServerWebSocket, code?: number, reason?: string) =>
        this.handleClose(ws, code, reason),
    });
  }

  use(mw: Middleware<TContext>): this {
    this.globalMiddlewares.push(mw);
    return this;
  }

  on(schema: MessageDescriptor, handler: EventHandler<TContext>): this {
    const entry: RouteEntry<TContext> = {
      schema,
      middlewares: [],
      handler,
    };
    this.routes.register(schema, entry);
    return this;
  }

  route(schema: MessageDescriptor): RouteBuilder<TContext> {
    return new RouteBuilderImpl(this, schema);
  }

  /**
   * Register a route (called by RouteBuilder after middleware chain is set).
   * @internal
   */
  registerRoute(entry: RouteEntry<TContext>): void {
    this.routes.register(entry.schema, entry);
  }

  merge(
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this {
    const otherRouteTable = this.getRouteTable(other);
    this.routes.merge(otherRouteTable, opts);
    return this;
  }

  mount(
    prefix: string,
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this {
    const otherRouteTable = this.getRouteTable(other);
    this.routes.mount(prefix, otherRouteTable, opts);
    return this;
  }

  plugin<P extends Plugin<TContext>>(plugin: P): ReturnType<P> {
    return this.pluginHost.apply(plugin);
  }

  onError(
    fn: (err: unknown, ctx: MinimalContext<TContext> | null) => void,
  ): this {
    this.lifecycle.onError(fn);
    return this;
  }

  observe(observer: Partial<RouterObserver<TContext>>): () => void {
    this.observers.push(observer);
    return () => {
      const idx = this.observers.indexOf(observer);
      if (idx >= 0) this.observers.splice(idx, 1);
    };
  }

  /**
   * Notify all registered observers of an event.
   * Uses snapshot-based dispatch for safe re-entrancy.
   * Swallows observer errors to prevent cascades.
   * @internal
   */
  private notifyObservers<K extends keyof RouterObserver<TContext>>(
    event: K,
    ...args: Parameters<NonNullable<RouterObserver<TContext>[K]>>
  ): void {
    // Snapshot the observer list for safe re-entrancy
    // (adding/removing observers mid-dispatch affects future calls, not current)
    const snapshot = this.observers.slice();
    for (const observer of snapshot) {
      try {
        const callback = observer[event];
        if (callback) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (callback as any)(...args);
        }
      } catch (err) {
        // Log observer error, don't propagate (prevent one bad observer from breaking others)
        console.error(`[Router] Observer error in ${String(event)}:`, err);
      }
    }
  }

  /**
   * Expose internal route table via symbol.
   * This is the ONLY sanctioned way to access the mutable route table.
   * Works across bundle boundaries without instanceof brittleness.
   *
   * Plugins should use getRouteIndex() helper instead to access schemas read-only.
   * @internal
   */
  [ROUTE_TABLE](): RouteTable<TContext> {
    return this.routes;
  }

  /**
   * Extract route table from another router via symbol accessor.
   * Works across multiple bundle copies (monorepo, playgrounds, etc.).
   * @internal
   */
  private extractRouteTable(other: Router<any>): RouteTable<TContext> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractor = (other as any)[ROUTE_TABLE];
    if (typeof extractor === "function") {
      return extractor.call(other);
    }
    throw new Error(
      "Cannot merge router: target does not expose internal route table symbol",
    );
  }

  /**
   * Get route table from another router (for merge/mount operations).
   * Delegates to extractRouteTable() for symbol-based access.
   * @internal
   */
  private getRouteTable(other: Router<any>): RouteTable<TContext> {
    return this.extractRouteTable(other);
  }

  /**
   * Internal route table accessor (test utility only).
   * Plugins should use getRouteIndex() instead for read-only schema lookups.
   * Access via symbol ([ROUTE_TABLE]) is the standard internal pattern.
   * @internal
   * @deprecated Use getRouteIndex() or [ROUTE_TABLE]() instead
   */
  get routeTable(): RouteTable<TContext> {
    return this.routes;
  }

  /**
   * Get internal lifecycle manager (used by plugins and testing).
   * @internal
   */
  getInternalLifecycle(): LifecycleManager<TContext> {
    return this.lifecycle;
  }

  /**
   * Get global middleware array (used by dispatch and testing).
   * @internal
   */
  getGlobalMiddlewares(): readonly Middleware<TContext>[] {
    return this.globalMiddlewares;
  }

  /**
   * Get limits configuration (used by dispatch).
   * @internal
   */
  getLimitsConfig(): CreateRouterOptions["limits"] | undefined {
    return this.limitsConfig;
  }

  /**
   * Get limits manager (used by dispatch for in-flight tracking).
   * @internal
   */
  getLimitsManager(): LimitsManager {
    return this.limitsManager;
  }

  /**
   * Get the set of capabilities added by plugins.
   * Useful for runtime feature detection (though type-level gating is preferred).
   * @internal
   */
  getCapabilities() {
    return this.pluginHost.getCapabilities();
  }

  /**
   * Get or initialize per-connection data from WeakMap.
   * Ensures connection data persists across all messages on the same socket.
   * @internal
   */
  private getOrInitData(ws: ServerWebSocket): TContext {
    let d = this.connData.get(ws);
    if (!d) {
      d = {} as TContext;
      this.connData.set(ws, d);
    }
    return d;
  }

  /**
   * Get or create a stable client ID for a WebSocket.
   * Assigns UUID on first call, then returns the same ID for subsequent calls.
   * @internal
   */
  private getOrCreateClientId(ws: ServerWebSocket): string {
    let id = this.wsToClientId.get(ws);
    if (!id) {
      // Use crypto.randomUUID() if available (Node 15.7+, Bun, browsers)
      // Fallback to Math.random for older Node versions (though this is a beta feature)
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Math.random().toString(36).substring(2)}-${Date.now()}`;
      this.wsToClientId.set(ws, id);
    }
    return id;
  }

  /**
   * Get the client ID for a WebSocket (if assigned).
   * Used by plugins to map ws ↔ clientId.
   * @internal
   */
  getClientId(ws: ServerWebSocket): string | undefined {
    return this.wsToClientId.get(ws);
  }

  /**
   * Notify observers of an error. Called by dispatch and error handlers.
   * @internal
   */
  notifyError(err: unknown, meta?: { clientId?: string; type?: string }): void {
    this.notifyObservers("onError", err, meta);
  }

  /**
   * Notify observers of a published message. Called by pubsub plugin after publishing.
   * @internal
   */
  notifyPublish(record: PublishRecord): void {
    this.notifyObservers("onPublish", record);
  }

  /**
   * Create a context from raw dispatch parameters.
   * This is a minimal implementation; validation plugins will extend it.
   * @internal
   */
  createContext(params: {
    clientId: string;
    ws: ServerWebSocket;
    type: string;
    payload?: unknown;
    meta?: Record<string, unknown>;
    receivedAt?: number;
  }): MinimalContext<TContext> {
    const data = this.getOrInitData(params.ws);
    return {
      clientId: params.clientId,
      ws: params.ws,
      type: params.type,
      data,
      setData: (partial: Partial<TContext>) => {
        Object.assign(data, partial);
      },
    };
  }

  /**
   * Handle connection open.
   * Marks connection as active, notifies open handlers, and starts heartbeat.
   * Called by adapters on WebSocket upgrade.
   * Idempotent; safe to call multiple times.
   *
   * @param ws - WebSocket connection
   */
  async handleOpen(ws: ServerWebSocket): Promise<void> {
    const now = Date.now();
    this.lifecycle.markActivity(ws, now);

    // Merge initial context data provided by the adapter (e.g., from headers, auth).
    // This runs before lifecycle.handleOpen, so onOpen handlers and plugins see seeded data.
    if (ws.initialData) {
      const ctx = this.getOrInitData(ws);
      Object.assign(ctx, ws.initialData);
    }

    // Notify plugins (e.g., pubsub for client tracking)
    await this.lifecycle.handleOpen(ws);

    // Notify observers
    const clientId = this.getOrCreateClientId(ws);
    const data = this.getOrInitData(ws);
    this.notifyObservers("onConnectionOpen", clientId, data);
  }

  /**
   * Handle incoming message frame.
   * Single entry point for inbound frames: parse, validate, dispatch through router pipeline.
   *
   * Never throws. All errors (parse, validation, handler, middleware) flow to router.onError()
   * via the lifecycle manager.
   *
   * @param ws - WebSocket connection
   * @param rawFrame - Raw message (string or ArrayBuffer, typically UTF-8 JSON)
   */
  async handleMessage(
    ws: ServerWebSocket,
    rawFrame: string | ArrayBuffer,
  ): Promise<void> {
    const clientId = this.getOrCreateClientId(ws);
    await dispatchMessage(rawFrame, clientId, ws, this);
  }

  /**
   * Handle connection close.
   * Cleans up per-connection data, notifies lifecycle handlers, and triggers plugin cleanup.
   * Called by adapters on WebSocket close/error.
   * Idempotent; safe to call multiple times.
   *
   * @param ws - WebSocket connection
   * @param code - WebSocket close code (optional, e.g., 1000 for normal close)
   * @param reason - Close reason (optional)
   */
  async handleClose(
    ws: ServerWebSocket,
    code?: number,
    reason?: string,
  ): Promise<void> {
    // Capture clientId before cleaning up
    const clientId = this.getClientId(ws);

    // Explicitly clean up per-connection data and client ID.
    // While WeakMap entries auto-clean when ws is GC'd, explicit deletion ensures
    // timely resource release and allows plugins to react via lifecycle hooks.
    this.connData.delete(ws);
    this.wsToClientId.delete(ws);

    // Notify lifecycle handlers (plugins, heartbeat monitor, etc.)
    // for per-connection cleanup. This allows plugins to perform cleanup
    // (pub/sub subscriptions, timers, etc.) on connection departure.
    await this.lifecycle.handleClose(ws, code, reason);

    // Notify observers
    if (clientId) {
      const closeInfo: { code?: number; reason?: string } = {};
      if (code !== undefined) {
        closeInfo.code = code;
      }
      if (reason !== undefined) {
        closeInfo.reason = reason;
      }
      this.notifyObservers("onConnectionClose", clientId, closeInfo);
    }
  }
}
