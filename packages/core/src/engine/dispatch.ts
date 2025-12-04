// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Message dispatch pipeline: decode → discriminate → lookup → context → middleware → handler
 * Full message processing from raw frame to handler execution.
 */

import type {
  ConnectionData,
  MinimalContext,
} from "../context/base-context.js";
import { ROUTE_TABLE } from "../core/symbols.js";
import type { EventHandler, Middleware } from "../core/types.js";
import type { RouterImpl, WsKitInternalState } from "../internal.js";
import type { MessageDescriptor } from "../protocol/message-descriptor.js";
import { isMessageDescriptor } from "../schema/guards.js";
import { getKind } from "../schema/metadata.js";
import { SYSTEM_MESSAGES, isReserved } from "../schema/reserved.js";
import { safeJsonParse } from "../utils/json.js";
import type { ServerWebSocket } from "../ws/platform-adapter.js";
import { composePipeline } from "./middleware.js";
import type { MessageEnvelope } from "./types.js";

export interface DispatchOptions<
  TContext extends ConnectionData = ConnectionData,
> {
  globalMiddleware: Middleware<TContext>[];
  routeMiddleware: Middleware<TContext>[];
  handler: EventHandler<TContext>;
}

/**
 * Low-level dispatch: run middleware → handler
 * Called by dispatchMessage after context is built.
 *
 * Errors are NOT caught here; callers handle error routing.
 */
export async function dispatch<
  TContext extends ConnectionData = ConnectionData,
>(
  ctx: MinimalContext<TContext>,
  schema: MessageDescriptor,
  opts: DispatchOptions<TContext>,
): Promise<void> {
  // Compose middleware: global then per-route
  const allMiddleware = [...opts.globalMiddleware, ...opts.routeMiddleware];
  const pipeline = composePipeline(allMiddleware);

  // Run middleware, then handler
  await pipeline(ctx, async () => {
    await opts.handler(ctx);
  });
}

/**
 * Full message dispatch pipeline.
 * Handles: parse → guard → lookup → context → limits → middleware → handler → errors.
 *
 * @param raw Raw message data (string or ArrayBuffer)
 * @param clientId Stable client identifier (assigned at accept time)
 * @param ws WebSocket connection
 * @param impl Router implementation (provides registry, lifecycle, context factory, etc.)
 */
export async function dispatchMessage<TContext extends ConnectionData>(
  raw: string | ArrayBuffer,
  clientId: string,
  ws: ServerWebSocket,
  impl: RouterImpl<TContext>,
): Promise<void> {
  const now = Date.now();

  // 1) Parse JSON safely
  let envelope: MessageEnvelope;
  {
    const text =
      typeof raw === "string"
        ? raw
        : new TextDecoder().decode(new Uint8Array(raw));
    const parseResult = safeJsonParse(
      text,
      impl.getLimitsConfig()?.maxPayloadBytes,
    );

    if (!parseResult.ok) {
      // Parse error → funnel to error sink without context
      const err = new Error(`Invalid JSON: ${parseResult.error}`);
      const lifecycle = impl.getInternalLifecycle();
      await lifecycle.handleError(err, null);
      impl.notifyError(err);
      return;
    }

    envelope = parseResult.value as MessageEnvelope;

    // Validate envelope shape
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      typeof envelope.type !== "string"
    ) {
      const err = new Error(
        "Invalid message envelope: missing or invalid type field",
      );
      const lifecycle = impl.getInternalLifecycle();
      await lifecycle.handleError(err, null);
      impl.notifyError(err);
      return;
    }
  }

  // 2) System message short-circuit (heartbeat)
  if (envelope.type === SYSTEM_MESSAGES.HEARTBEAT) {
    const lifecycle = impl.getInternalLifecycle();
    lifecycle.markActivity(ws, now);
    try {
      ws.send(
        JSON.stringify({
          type: SYSTEM_MESSAGES.HEARTBEAT_ACK,
          meta: { ts: now },
        }),
      );
    } catch (err) {
      await lifecycle.handleError(err, null);
      impl.notifyError(err);
    }
    return;
  }

  // 3) Reserved types are blocked from user handlers
  if (isReserved(envelope.type)) {
    const err = new Error(
      `Reserved type cannot be handled by user code: "${envelope.type}"`,
    );
    const lifecycle = impl.getInternalLifecycle();
    await lifecycle.handleError(err, null);
    impl.notifyError(err);
    return;
  }

  // 4) Lookup handler by message type
  const extractRoutes = (impl as any)[ROUTE_TABLE];
  if (typeof extractRoutes !== "function") {
    const err = new Error(
      "Router does not expose internal route table (missing symbol accessor)",
    );
    const lifecycle = impl.getInternalLifecycle();
    await lifecycle.handleError(err, null);
    impl.notifyError(err);
    return;
  }
  const routeTable = extractRoutes.call(impl);
  const entry = routeTable.get(envelope.type);
  if (!entry) {
    const err = new Error(
      `No handler registered for message type: "${envelope.type}"`,
    );
    const lifecycle = impl.getInternalLifecycle();
    await lifecycle.handleError(err, null);
    impl.notifyError(err);
    return;
  }

  // 5) Validate runtime schema shape
  const schema: MessageDescriptor = entry.schema;
  if (!isMessageDescriptor(schema)) {
    const err = new Error(
      `Invalid MessageDescriptor for type "${envelope.type}"`,
    );
    const lifecycle = impl.getInternalLifecycle();
    await lifecycle.handleError(err, null);
    impl.notifyError(err);
    return;
  }

  // 6) Build minimal context
  let ctx: MinimalContext<TContext> | null = null;
  try {
    const contextData: {
      clientId: string;
      ws: ServerWebSocket;
      type: string;
      payload?: unknown;
      meta?: Record<string, unknown>;
      receivedAt: number;
    } = {
      clientId,
      ws,
      type: schema.messageType,
      receivedAt: now,
    };
    if (envelope.payload !== undefined) {
      contextData.payload = envelope.payload;
    }
    if (envelope.meta !== undefined) {
      contextData.meta = envelope.meta;
    }
    ctx = await impl.createContext(contextData);
  } catch (err) {
    const lifecycle = impl.getInternalLifecycle();
    await lifecycle.handleError(err, null);
    impl.notifyError(err);
    return;
  }

  // 7) Check limits (maxPending)
  const limitsConfig = impl.getLimitsConfig();
  let release: (() => void) | null = null;
  if (limitsConfig?.maxPending) {
    const limitsManager = impl.getLimitsManager();
    try {
      release = limitsManager.begin();
    } catch (err) {
      const lifecycle = impl.getInternalLifecycle();
      await lifecycle.handleError(err, ctx);
      impl.notifyError(err, {
        clientId,
        type: schema.messageType,
      });
      return;
    }
  }

  try {
    // 8) Update activity timestamp
    const lifecycle = impl.getInternalLifecycle();
    lifecycle.markActivity(ws, now);

    // 9) Run pipeline: global → per-route → handler
    const globalMiddleware = impl.getGlobalMiddlewares();
    const routeMiddleware = entry.middlewares;

    await dispatch(ctx, schema, {
      globalMiddleware: [...globalMiddleware],
      routeMiddleware,
      handler: entry.handler,
    });

    // 10) Check for incomplete RPC handlers
    const kind = getKind(schema);
    const shouldWarn = impl.getWarnIncompleteRpc();

    if (kind === "rpc" && shouldWarn) {
      const wskit = (ctx as any).__wskit as WsKitInternalState | undefined;
      // If handler completed without replying (and no error was thrown), warn.
      // Note: ctx.error() sets replied=true, so we only check replied flag.
      if (wskit?.rpc && !wskit.rpc.replied) {
        console.warn(
          `[ws] RPC handler for "${schema.messageType}" completed without calling ctx.reply() or ctx.error(). ` +
            `If this is intentional (async response), set { warnIncompleteRpc: false } in createRouter().`,
        );
      }
    }
  } catch (err) {
    // Catch errors from middleware or handler
    const lifecycle = impl.getInternalLifecycle();
    await lifecycle.handleError(err, ctx);
    impl.notifyError(err, {
      clientId,
      type: schema.messageType,
    });
  } finally {
    // 10) Release limits tracking
    release?.();
  }
}
