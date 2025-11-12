/**
 * BaseRouter implementation.
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

import type { MessageDescriptor } from "../protocol/message-descriptor";
import type { MinimalContext, BaseContextData } from "../context/base-context";
import type {
  Middleware,
  EventHandler,
  RouteEntry,
  CreateRouterOptions,
} from "./types";
import type { Plugin } from "../plugin/types";
import type { ServerWebSocket } from "../ws/platform-adapter";
import { RouteTable } from "./route-table";
import { LifecycleManager } from "../engine/lifecycle";
import { LimitsManager } from "../engine/limits-manager";
import { PluginHost } from "../plugin/manager";
import { dispatchMessage } from "../engine/dispatch";
import { INTERNAL_ROUTES } from "./symbols";

export interface BaseRouter<TConn> {
  use(mw: Middleware<TConn>): this;
  on(schema: MessageDescriptor, handler: EventHandler<TConn>): this;
  route(schema: MessageDescriptor): RouteBuilder<TConn>;
  merge(
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this;
  mount(
    prefix: string,
    other: Router<any>,
    opts?: { onConflict?: "error" | "skip" | "replace" },
  ): this;
  plugin<P extends Plugin<TConn>>(plugin: P): ReturnType<P>;
  onError(fn: (err: unknown, ctx: MinimalContext<TConn> | null) => void): this;
}

/**
 * Router<TConn, Caps> = BaseRouter + capability-gated APIs
 * Caps is merged from plugins; unknown plugins don't widen the type.
 */
export type Router<TConn = unknown, Caps = {}> = BaseRouter<TConn> &
  (Caps extends { validation: true } ? ValidationAPI<TConn> : {}) &
  (Caps extends { pubsub: true } ? PubSubAPI<TConn> : {});

/**
 * Validation API appears when withZod() or withValibot() is plugged.
 * Only addition: rpc() method (on() already exists in base).
 */
export interface ValidationAPI<TConn> {
  rpc(
    schema: MessageDescriptor & { response: MessageDescriptor },
    handler: any, // RpcHandler<TConn> (inferred by validation plugin)
  ): this;
}

/**
 * Pub/Sub API appears when withPubSub() is plugged.
 */
export interface PubSubAPI<TConn> {
  publish(
    topic: string,
    schema: MessageDescriptor,
    payload: unknown,
    opts?: { partitionKey?: string; meta?: Record<string, unknown> },
  ): Promise<void>;

  subscriptions: {
    list(): readonly string[];
    has(topic: string): boolean;
  };
}

/**
 * Per-route builder (fluent interface):
 *   router.route(schema).use(mw).use(mw2).on(handler)
 */
export interface RouteBuilder<TConn> {
  use(mw: Middleware<TConn>): this;
  on(handler: EventHandler<TConn>): void;
}

/**
 * Per-route builder implementation.
 * Accumulates middleware for a single message type, then registers with router.
 */
export class CoreRouteBuilder<TConn> implements RouteBuilder<TConn> {
  private middlewares: Middleware<TConn>[] = [];

  constructor(
    private router: CoreRouter<TConn>,
    private schema: MessageDescriptor,
  ) {}

  use(mw: Middleware<TConn>): this {
    this.middlewares.push(mw);
    return this;
  }

  on(handler: EventHandler<TConn>): void {
    const entry: RouteEntry<TConn> = {
      schema: this.schema,
      middlewares: this.middlewares,
      handler,
    };
    this.router.registerRoute(entry);
  }
}

/**
 * CoreRouter implementation.
 * Stores global middleware, per-route handlers (via registry), and error hooks.
 */
export class CoreRouter<TConn extends BaseContextData = unknown>
  implements BaseRouter<TConn>
{
  private globalMiddlewares: Middleware<TConn>[] = [];
  private routes = new RouteTable<TConn>();
  private lifecycle = new LifecycleManager<TConn>();
  private limitsManager: LimitsManager;
  private pluginHost: PluginHost<TConn>;
  private connData = new WeakMap<ServerWebSocket, TConn>();

  constructor(private limitsConfig?: CreateRouterOptions["limits"]) {
    this.limitsManager = new LimitsManager(limitsConfig);
    // Initialize plugin host with self reference (cast to bypass recursive type)
    this.pluginHost = new PluginHost<TConn>(this as any as Router<TConn>);
  }

  use(mw: Middleware<TConn>): this {
    this.globalMiddlewares.push(mw);
    return this;
  }

  on(schema: MessageDescriptor, handler: EventHandler<TConn>): this {
    const entry: RouteEntry<TConn> = {
      schema,
      middlewares: [],
      handler,
    };
    this.routes.register(schema, entry);
    return this;
  }

  route(schema: MessageDescriptor): RouteBuilder<TConn> {
    return new CoreRouteBuilder(this, schema);
  }

  /**
   * Register a route (called by RouteBuilder after middleware chain is set).
   * @internal
   */
  registerRoute(entry: RouteEntry<TConn>): void {
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

  plugin<P extends Plugin<TConn>>(plugin: P): ReturnType<P> {
    return this.pluginHost.apply(plugin);
  }

  onError(fn: (err: unknown, ctx: MinimalContext<TConn> | null) => void): this {
    this.lifecycle.onError(fn);
    return this;
  }

  /**
   * Expose internal route table via symbol.
   * Enables cross-bundle duck-typing without instanceof brittleness.
   * @internal
   */
  [INTERNAL_ROUTES](): RouteTable<TConn> {
    return this.routes;
  }

  /**
   * Extract route table from another router via symbol accessor.
   * Works across multiple bundle copies (monorepo, playgrounds, etc.).
   * @internal
   */
  private extractRouteTable(other: Router<any>): RouteTable<TConn> {
    const extractor = (other as any)[INTERNAL_ROUTES];
    if (typeof extractor === "function") {
      return extractor.call(other);
    }
    throw new Error(
      "Cannot merge router: target is not a CoreRouter instance or does not expose internal route table",
    );
  }

  /**
   * Get route table from another router (for merge/mount operations).
   * Delegates to extractRouteTable() for symbol-based access.
   * @internal
   */
  private getRouteTable(other: Router<any>): RouteTable<TConn> {
    return this.extractRouteTable(other);
  }

  /**
   * Internal route table (used by plugins and testing).
   * @internal
   */
  get routeTable(): RouteTable<TConn> {
    return this.routes;
  }

  /**
   * Get internal lifecycle manager (used by plugins and testing).
   * @internal
   */
  getInternalLifecycle(): LifecycleManager<TConn> {
    return this.lifecycle;
  }

  /**
   * Get global middleware array (used by dispatch and testing).
   * @internal
   */
  getGlobalMiddlewares(): readonly Middleware<TConn>[] {
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
  private getOrInitData(ws: ServerWebSocket): TConn {
    let d = this.connData.get(ws);
    if (!d) {
      d = {} as TConn;
      this.connData.set(ws, d);
    }
    return d;
  }

  /**
   * Create a context from raw dispatch parameters.
   * This is a minimal implementation; validation plugins will extend it.
   * @internal
   */
  createContext(params: {
    ws: ServerWebSocket;
    type: string;
    payload?: unknown;
    meta?: Record<string, unknown>;
    receivedAt?: number;
  }): MinimalContext<TConn> {
    const data = this.getOrInitData(params.ws);
    return {
      ws: params.ws,
      type: params.type,
      data,
      setData: (partial: Partial<TConn>) => {
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
    // Notify plugins (e.g., pubsub for client tracking)
    await this.lifecycle.handleOpen(ws);
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
    await dispatchMessage(rawFrame, ws, this);
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
    // Explicitly clean up per-connection data from WeakMap.
    // While WeakMap entries auto-clean when ws is GC'd, explicit deletion ensures
    // timely resource release and allows plugins to react via lifecycle hooks.
    this.connData.delete(ws);

    // Notify lifecycle handlers (plugins, heartbeat monitor, etc.)
    // for per-connection cleanup. This allows plugins to perform cleanup
    // (pub/sub subscriptions, timers, etc.) on connection departure.
    await this.lifecycle.handleClose(ws, code, reason);
  }
}
