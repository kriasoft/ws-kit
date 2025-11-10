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

import type { MessageDescriptor } from "../../protocol/message-descriptor";
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
   * Get route table from another router (for merge/mount operations).
   * Extracts the internal route table by duck-typing.
   * @internal
   */
  private getRouteTable(other: Router<any>): RouteTable<TConn> {
    if (other instanceof CoreRouter && other.routes instanceof RouteTable) {
      return (other as CoreRouter<TConn>).routes;
    }
    // Fallback for external implementations
    throw new Error("Cannot merge router: target is not a CoreRouter instance");
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
    const data = {} as TConn;
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
   * Marks connection as active. Called by adapters on WebSocket upgrade.
   * Idempotent; safe to call multiple times.
   *
   * @param ws - WebSocket connection
   */
  async handleOpen(ws: ServerWebSocket): Promise<void> {
    const now = Date.now();
    this.lifecycle.markActivity(ws, now);
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
   * Idempotent cleanup. Called by adapters on WebSocket close/error.
   * Calling multiple times is safe (no-op on second and subsequent calls).
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
    // Idempotent cleanup: no-op. Core doesn't maintain per-connection state.
    // Plugins (pub/sub, etc.) handle their own cleanup via onError/lifecycle hooks.
  }
}
