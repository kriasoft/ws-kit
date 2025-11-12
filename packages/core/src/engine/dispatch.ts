// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Message dispatch pipeline: decode → discriminate → lookup → context → middleware → handler
 * Full message processing from raw frame to handler execution.
 */

import type { BaseContextData, MinimalContext } from "../context/base-context";
import type { CoreRouter } from "../core/router";
import type { EventHandler, Middleware } from "../core/types";
import type { MessageDescriptor } from "../protocol/message-descriptor";
import { isMessageDescriptor } from "../schema/guards";
import { SYSTEM_MESSAGES, isReservedType } from "../schema/reserved";
import { safeJsonParse } from "../utils/json";
import type { ServerWebSocket } from "../ws/platform-adapter";
import { composePipeline } from "./middleware";
import type { MessageEnvelope } from "./types";

export interface DispatchOptions<TContext> {
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
export async function dispatch<TContext>(
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
export async function dispatchMessage<TContext extends BaseContextData>(
  raw: string | ArrayBuffer,
  clientId: string,
  ws: ServerWebSocket,
  impl: CoreRouter<TContext>,
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
      const lifecycle = impl.getInternalLifecycle();
      await lifecycle.handleError(
        new Error(`Invalid JSON: ${parseResult.error}`),
        null,
      );
      return;
    }

    envelope = parseResult.value as MessageEnvelope;

    // Validate envelope shape
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      typeof envelope.type !== "string"
    ) {
      const lifecycle = impl.getInternalLifecycle();
      await lifecycle.handleError(
        new Error("Invalid message envelope: missing or invalid type field"),
        null,
      );
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
    }
    return;
  }

  // 3) Reserved types are blocked from user handlers
  if (isReservedType(envelope.type)) {
    const lifecycle = impl.getInternalLifecycle();
    const err = new Error(
      `Reserved type cannot be handled by user code: "${envelope.type}"`,
    );
    await lifecycle.handleError(err, null);
    return;
  }

  // 4) Lookup handler by message type
  const routeTable = impl.routeTable;
  const entry = routeTable.get(envelope.type);
  if (!entry) {
    const lifecycle = impl.getInternalLifecycle();
    const err = new Error(
      `No handler registered for message type: "${envelope.type}"`,
    );
    await lifecycle.handleError(err, null);
    return;
  }

  // 5) Validate runtime schema shape
  const schema: MessageDescriptor = entry.schema;
  if (!isMessageDescriptor(schema)) {
    const lifecycle = impl.getInternalLifecycle();
    const err = new Error(
      `Invalid MessageDescriptor for type "${envelope.type}"`,
    );
    await lifecycle.handleError(err, null);
    return;
  }

  // 6) Build minimal context
  let ctx: MinimalContext<TConn> | null = null;
  try {
    ctx = impl.createContext({
      clientId,
      ws,
      type: schema.type,
      payload: envelope.payload,
      meta: envelope.meta,
      receivedAt: now,
    });
  } catch (err) {
    const lifecycle = impl.getInternalLifecycle();
    await lifecycle.handleError(err, null);
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
  } catch (err) {
    // Catch errors from middleware or handler
    const lifecycle = impl.getInternalLifecycle();
    await lifecycle.handleError(err, ctx);
  } finally {
    // 10) Release limits tracking
    release?.();
  }
}
