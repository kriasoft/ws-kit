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
import { createCoreErrorEnhancer } from "../context/error-handling";
import type { EventContext } from "../context/event-context";
import type { PubSubContext } from "../context/pubsub-context";
import type { RpcContext } from "../context/rpc-context";
import { dispatchMessage } from "../engine/dispatch";
import { LifecycleManager } from "../engine/lifecycle";
import { LimitsManager } from "../engine/limits-manager";
import type { ContextEnhancer } from "../internal";
import { PluginHost } from "../plugin/manager";
import type { Plugin } from "../plugin/types";
import type {
  AnySchema,
  InferPayload,
  InferResponse,
  InferType,
  MessageDescriptor,
} from "../protocol/schema";
import { getKind } from "../schema/metadata";
import type { AdapterWebSocket, ServerWebSocket } from "../ws/platform-adapter";
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

export type {
  Plugin,
  PublishCapability,
  PublishError,
  PublishOptions,
  PublishResult,
};

/**
 * Extracts the API type a plugin contributes.
 * @internal
 */
type InferPluginAPI<P> = P extends Plugin<any, infer Api> ? Api : never;

export interface RouterCore<TContext extends ConnectionData = ConnectionData> {
  use(mw: Middleware<TContext>): this;
  on(schema: MessageDescriptor, handler: EventHandler<TContext>): this;
  route<S extends MessageDescriptor>(schema: S): RouteBuilder<TContext, S>;
  merge(
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this;
  mount(
    prefix: string,
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this;
  /**
   * Apply a plugin to extend the router's capabilities.
   * Uses this-aware inference to preserve existing extensions through chaining.
   *
   * @typeParam E - Current extensions (inferred from this)
   * @typeParam P - Plugin type
   */
  plugin<E extends object, P extends Plugin<TContext, any>>(
    this: Router<TContext, E>,
    plugin: P,
  ): RouterWithExtensions<TContext, E & InferPluginAPI<P>>;
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
 * Router<TContext, TExtensions> = RouterCore + plugin-contributed APIs.
 *
 * TExtensions is an object type representing all APIs added by plugins.
 * Plugins use definePlugin<TContext, TPluginApi> to add their extensions.
 * Type is automatically widened: each .plugin(p) call intersects new APIs.
 *
 * Per ADR-028, Router uses pure structural composition. Plugin APIs
 * (rpc, publish, topics, etc.) are included directly via TExtensions.
 * Plugins contribute their full API through their TPluginApi type parameter.
 *
 * @example
 * ```typescript
 * // Base (no plugins):
 * Router<MyContext, {}> → RouterCore<MyContext>
 *
 * // After withZod (adds validation API):
 * Router<MyContext, WithZodCapability>
 * → RouterCore<MyContext> & { validation: true, rpc(), ... }
 *
 * // After both withZod and withPubSub:
 * Router<MyContext, WithZodCapability & WithPubSubAPI>
 * → RouterCore<MyContext> & { rpc(), publish(), topics, ... }
 * ```
 */
export interface Router<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> extends Omit<
  RouterCore<TContext>,
  "plugin" | "use" | "on" | "onError" | "merge" | "mount"
> {
  /**
   * Register global middleware. Preserves extension types through fluent chaining.
   */
  use(mw: Middleware<TContext>): RouterWithExtensions<TContext, TExtensions>;

  /**
   * Register an event handler. Preserves extension types through fluent chaining.
   */
  on(
    schema: MessageDescriptor,
    handler: EventHandler<TContext>,
  ): RouterWithExtensions<TContext, TExtensions>;

  /**
   * Register an error handler. Preserves extension types through fluent chaining.
   */
  onError(
    fn: (err: unknown, ctx: MinimalContext<TContext> | null) => void,
  ): RouterWithExtensions<TContext, TExtensions>;

  /**
   * Merge routes from another router. Preserves extension types through fluent chaining.
   */
  merge(
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): RouterWithExtensions<TContext, TExtensions>;

  /**
   * Mount routes from another router with a prefix. Preserves extension types through fluent chaining.
   */
  mount(
    prefix: string,
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): RouterWithExtensions<TContext, TExtensions>;

  /**
   * Apply a plugin to extend the router's capabilities.
   * Uses this-aware inference to preserve existing extensions through chaining.
   *
   * @typeParam E - Current extensions (inferred from this)
   * @typeParam P - Plugin type
   */
  plugin<E extends object, P extends Plugin<TContext, any>>(
    this: Router<TContext, E>,
    plugin: P,
  ): RouterWithExtensions<TContext, E & InferPluginAPI<P>>;
}

/**
 * Capability detection helper.
 *
 * Checks for capability markers in two forms:
 * 1. Modern: `__caps: { validation: true }` or `__caps: { pubsub: true }`
 * 2. Legacy: `{ validation: true }` or `{ pubsub: true }` at top level
 *
 * This allows plugins to migrate to __caps gradually while maintaining
 * backwards compatibility with existing boolean markers.
 */
type HasCapability<T, K extends string> = T extends { __caps: infer C }
  ? C extends Record<K, true>
    ? true
    : false
  : T extends Record<K, true>
    ? true
    : false;

/**
 * Full Router type with extensions and capability-gated APIs applied.
 *
 * Combines Router interface with:
 * - Direct extensions from plugins (minus internal markers)
 * - Capability-gated APIs based on extension markers:
 *   - { validation: true } or { __caps: { validation: true } } → ValidationAPI
 *   - { pubsub: true } or { __caps: { pubsub: true } } → PubSubAPI
 *
 * Note: We only omit `__caps` and `validation` (boolean marker).
 * The `pubsub` property is preserved if it's a runtime object (tap/init/shutdown).
 *
 * This is the type returned by plugin() and definePlugin().
 */
export type RouterWithExtensions<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> = Router<TContext, TExtensions> &
  Omit<TExtensions, "__caps" | "validation"> &
  (HasCapability<TExtensions, "validation"> extends true
    ? ValidationAPI<TContext, TExtensions>
    : {}) &
  (HasCapability<TExtensions, "pubsub"> extends true
    ? PubSubAPI<TContext>
    : {});

/**
 * Validation API appears when withZod() or withValibot() is plugged.
 * It overloads `on()` and `rpc()` with type-safe handlers.
 *
 * TContext is the per-connection data type.
 * TExtensions captures installed plugin capabilities - when pubsub is present,
 * handlers receive PubSubContext methods (ctx.publish, ctx.topics).
 */
export interface ValidationAPI<
  TContext extends ConnectionData = ConnectionData,
  TExtensions extends object = {},
> {
  on<S extends AnySchema>(
    schema: S,
    handler: (
      ctx: EventContext<TContext, InferPayload<S>> &
        (HasCapability<TExtensions, "pubsub"> extends true
          ? PubSubContext
          : {}) & { type: InferType<S> },
    ) => void,
  ): this;
  rpc<S extends AnySchema>(
    schema: S,
    handler: (
      ctx: RpcContext<TContext, InferPayload<S>, InferResponse<S>> &
        (HasCapability<TExtensions, "pubsub"> extends true
          ? PubSubContext
          : {}) & {
          type: InferType<S>;
        },
    ) => void,
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
  S extends MessageDescriptor = MessageDescriptor,
> {
  use(mw: Middleware<TContext>): this;
  on(
    handler: S extends AnySchema
      ? (
          ctx: EventContext<TContext, InferPayload<S>> & { type: InferType<S> },
        ) => void
      : EventHandler<TContext>,
  ): void;
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
class RouteBuilderImpl<
  TContext extends ConnectionData = ConnectionData,
  S extends MessageDescriptor = MessageDescriptor,
> implements RouteBuilder<TContext, S> {
  private middlewares: Middleware<TContext>[] = [];

  constructor(
    private router: RouterImpl<TContext>,
    private schema: S,
  ) {}

  use(mw: Middleware<TContext>): this {
    this.middlewares.push(mw);
    return this;
  }

  on(
    handler: S extends AnySchema
      ? (
          ctx: EventContext<TContext, InferPayload<S>> & { type: InferType<S> },
        ) => void
      : EventHandler<TContext>,
  ): void {
    const entry: RouteEntry<TContext> = {
      schema: this.schema as unknown as MessageDescriptor,
      middlewares: this.middlewares,
      // handler type is runtime-compatible (middleware chain handles context)
      handler: handler as EventHandler<TContext>,
    };
    this.router.registerRoute(entry);
  }
}

/**
 * RouterImpl implementation.
 * Stores global middleware, per-route handlers (via registry), and error hooks.
 * @internal
 */
export class RouterImpl<
  TContext extends ConnectionData = ConnectionData,
> implements RouterCore<TContext> {
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

  /**
   * Context enhancers: pure functions that extend context after creation.
   * Each entry has the function, priority (lower runs first), and registration order.
   * @internal
   */
  private contextEnhancers: {
    fn: ContextEnhancer<TContext>;
    priority: number;
    order: number;
  }[] = [];

  /**
   * Next order for enhancers (for stable registration order).
   * @internal
   */
  private nextEnhancerOrder = 0;

  private warnIncompleteRpc: boolean;
  private limitsConfig?: CreateRouterOptions["limits"];

  constructor(options: CreateRouterOptions = {}) {
    this.limitsConfig = options.limits;
    this.limitsManager = new LimitsManager(this.limitsConfig);
    this.warnIncompleteRpc =
      options.warnIncompleteRpc ?? process.env.NODE_ENV !== "production";

    // Initialize plugin host with self reference (cast to bypass recursive type)
    this.pluginHost = new PluginHost<TContext>(this as any as Router<TContext>);
    // Attach to symbol for internal access escape hatch
    (this as any)[ROUTER_IMPL] = this;
    // Register core error enhancer with very high priority (runs first) to ensure
    // ctx.error is always available before other plugins add their enhancements.
    // Pass lifecycle manager so all errors flow through observability hooks.
    this.addContextEnhancer(createCoreErrorEnhancer(this.lifecycle), {
      priority: -1000,
    });
  }

  /**
   * Get warning configuration for incomplete RPC handlers.
   * @internal
   */
  getWarnIncompleteRpc(): boolean {
    return this.warnIncompleteRpc;
  }

  /**
   * Register a context enhancer.
   * Enhancers run in priority order, then registration order.
   * @internal For use by plugins via getRouterPluginAPI()
   */
  addContextEnhancer(
    enhancer: ContextEnhancer<TContext>,
    opts?: { priority?: number },
  ): void {
    this.contextEnhancers.push({
      fn: enhancer,
      priority: opts?.priority ?? 0,
      order: this.nextEnhancerOrder++,
    });
  }

  /**
   * Get sorted enhancers (by priority, then order).
   * @internal
   */
  private getSortedEnhancers(): ContextEnhancer<TContext>[] {
    return this.contextEnhancers
      .sort((a, b) => a.priority - b.priority || a.order - b.order)
      .map((e) => e.fn);
  }

  /**
   * Get a read-only view of the route registry for plugins.
   * @internal For use by plugins via getRouterPluginAPI()
   */
  getRouteRegistryForInternals(): ReadonlyMap<
    string,
    { schema?: unknown; kind?: string }
  > {
    const result = new Map<string, { schema?: unknown; kind?: string }>();
    for (const [type, entry] of this.routes.list()) {
      // Read kind from DESCRIPTOR symbol via getKind()
      const kind = getKind(entry.schema);
      result.set(
        type,
        kind !== undefined
          ? { schema: entry.schema, kind }
          : { schema: entry.schema },
      );
    }
    return result;
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

  /**
   * Register an RPC handler. Runtime is always available, but the public API is
   * type-gated by validation plugins via the { validation: true } capability.
   */
  rpc(
    schema: MessageDescriptor & { response?: MessageDescriptor },
    handler: EventHandler<TContext>,
  ): this {
    if (!this.pluginHost.getCapabilities().validation) {
      throw new Error(
        "rpc() requires a validation plugin (withZod() or withValibot())",
      );
    }

    // Read kind from DESCRIPTOR symbol (no fallback to schema.kind)
    const kind = getKind(schema);
    if (kind !== "rpc") {
      throw new Error(
        `Schema kind mismatch for "${schema.messageType}": expected kind="rpc", got "${kind}"`,
      );
    }

    if (!schema.response) {
      throw new Error(
        `RPC schema for type "${schema.messageType}" must include a response descriptor`,
      );
    }

    const entry: RouteEntry<TContext> = {
      schema,
      middlewares: [],
      handler,
    };
    this.routes.register(schema, entry);
    return this;
  }

  route<S extends MessageDescriptor>(schema: S): RouteBuilder<TContext, S> {
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

  plugin<E extends object, P extends Plugin<TContext, any>>(
    this: Router<TContext, E>,
    plugin: P,
  ): RouterWithExtensions<TContext, E & InferPluginAPI<P>> {
    // Cast this to RouterImpl to access pluginHost
    const impl = this as unknown as RouterImpl<TContext>;
    return impl.pluginHost.apply(plugin) as RouterWithExtensions<
      TContext,
      E & InferPluginAPI<P>
    >;
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
  async createContext(params: {
    clientId: string;
    ws: ServerWebSocket;
    type: string;
    payload?: unknown;
    meta?: Record<string, unknown>;
    receivedAt?: number;
  }): Promise<MinimalContext<TContext>> {
    const data = this.getOrInitData(params.ws);
    // Build context incrementally; error method will be added by core error enhancer
    const ctx = {
      clientId: params.clientId,
      ws: params.ws,
      type: params.type,
      data,
      extensions: new Map<string, unknown>(),
      assignData: (partial: Partial<TContext>) => {
        Object.assign(data, partial);
      },
      payload: undefined as unknown,
      meta: {} as Record<string, unknown>,
      receivedAt: undefined as number | undefined,
      error: undefined as any, // Placeholder; will be set by core error enhancer
    };

    if ("payload" in params) {
      ctx.payload = params.payload;
    }

    ctx.meta = params.meta ?? {};

    if (params.receivedAt !== undefined) {
      ctx.receivedAt = params.receivedAt;
    }

    // Run enhancers in priority order, with conflict detection in dev mode
    const isDev = process.env.NODE_ENV !== "production";

    // Track protected keys (base keys + keys added by previous enhancers)
    // We use value comparison to detect actual overwrites, not just key presence
    const protectedKeys = isDev ? new Set(Object.keys(ctx)) : null;

    // Allow specific overwrites (e.g. 'error' placeholder is overwritten by core enhancer)
    const allowedOverwrites = new Set(["error"]);

    for (const enhance of this.getSortedEnhancers()) {
      // Snapshot values of protected keys before this enhancer runs
      const valuesBefore =
        isDev && protectedKeys
          ? new Map(Array.from(protectedKeys).map((k) => [k, (ctx as any)[k]]))
          : null;

      try {
        await enhance(ctx);
      } catch (err) {
        // Route to lifecycle, fail message (not router)
        await this.lifecycle.handleError(err, ctx);
        throw err;
      }

      // Conflict detection (dev mode only)
      // Warn if an enhancer actually changes a protected key's value
      if (valuesBefore && protectedKeys) {
        const overwrites: string[] = [];

        // Check if any protected key's value was changed
        for (const [key, oldVal] of valuesBefore) {
          // Use strict equality - if reference changes, it's an overwrite
          if (
            (ctx as any)[key] !== oldVal &&
            !allowedOverwrites.has(key) &&
            key !== "extensions"
          ) {
            overwrites.push(key);
          }
        }

        if (overwrites.length > 0) {
          console.warn(
            `[ws-kit] Enhancer overwrote ctx properties: ${overwrites.join(", ")}. ` +
              `Consider using ctx.extensions for plugin-specific data.`,
          );
        }

        // Add newly added keys to protected set for future enhancers
        for (const k of Object.keys(ctx)) {
          protectedKeys.add(k);
        }
      }
    }

    // After enhancers run, ctx is guaranteed to have error method (from core error enhancer)
    return ctx as MinimalContext<TContext>;
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
    // Cast to AdapterWebSocket to access adapter-only initialData field.
    const adapterWs = ws as AdapterWebSocket;
    if (adapterWs.initialData) {
      const ctx = this.getOrInitData(ws);
      Object.assign(ctx, adapterWs.initialData);
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

    // Notify lifecycle handlers FIRST (plugins, heartbeat monitor, etc.)
    // so they can access clientId via getClientId(ws) for cleanup tasks
    // (pub/sub subscriptions, timers, etc.)
    await this.lifecycle.handleClose(ws, code, reason);

    // Clean up per-connection data and client ID AFTER lifecycle handlers.
    // While WeakMap entries auto-clean when ws is GC'd, explicit deletion
    // ensures timely resource release.
    this.connData.delete(ws);
    this.wsToClientId.delete(ws);

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
