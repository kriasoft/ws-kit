// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Browser WebSocket client with type-safe messaging.
 * See @docs/specs/client.md for full API documentation.
 */

import {
  attachTokenToUrl,
  getAuthToken,
  mergeProtocols,
  validateProtocolPrefix,
} from "./auth.js";
import { calculateBackoff } from "./backoff.js";
import { StateError } from "./errors.js";
import { HandlerRegistry } from "./handlers.js";
import { normalizeOutboundMeta } from "./normalize.js";
import { MessageQueue } from "./queue.js";
import { RequestTracker } from "./requests.js";
import type {
  AnyInboundMessage,
  AnyMessageSchema,
  ClientOptions,
  ClientState,
  MessageHandler,
  WebSocketClient,
} from "./types.js";

export * from "./errors.js";
export * from "./types.js";

// Reserved + managed meta keys (MUST strip from user meta)
// See @docs/specs/client.md#client-normalization and @docs/specs/rules.md#client-side-constraints
const RESERVED_MANAGED_META_KEYS = new Set([
  "clientId", // Server-only
  "receivedAt", // Server-only
  "correlationId", // Client-managed (via opts.correlationId only)
]);

/**
 * Creates a type-safe WebSocket client.
 */
export function createClient(opts: ClientOptions): WebSocketClient {
  // Validate options
  if (opts.auth?.attach === "protocol" && opts.auth.protocolPrefix) {
    validateProtocolPrefix(opts.auth.protocolPrefix);
  }

  // Internal state
  let ws: WebSocket | null = null;
  let state: ClientState = "closed";
  let selectedProtocol = "";
  let reconnectAttempts = 0;
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let connectPromise: Promise<void> | null = null;
  let manualClose = false; // Track if user called close() (prevents auto-reconnect)
  let everAttemptedConnect = false; // Track if connection was ever attempted (for autoConnect)

  // Configuration with defaults
  const config = {
    url: opts.url,
    protocols: opts.protocols,
    reconnect: {
      enabled: opts.reconnect?.enabled ?? true,
      maxAttempts: opts.reconnect?.maxAttempts ?? Infinity,
      initialDelayMs: opts.reconnect?.initialDelayMs ?? 300,
      maxDelayMs: opts.reconnect?.maxDelayMs ?? 10_000,
      jitter: opts.reconnect?.jitter ?? "full",
    },
    queue: opts.queue ?? "drop-newest",
    queueSize: opts.queueSize ?? 1000,
    autoConnect: opts.autoConnect ?? false,
    pendingRequestsLimit: opts.pendingRequestsLimit ?? 1000,
    auth: {
      attach: opts.auth?.attach ?? "query",
      queryParam: opts.auth?.queryParam ?? "access_token",
      protocolPrefix: opts.auth?.protocolPrefix ?? "bearer.",
      protocolPosition: opts.auth?.protocolPosition ?? "append",
      getToken: opts.auth?.getToken,
    },
    wsFactory:
      opts.wsFactory ?? ((url, protocols) => new WebSocket(url, protocols)),
  };

  // Components
  const queue = new MessageQueue(config.queue, config.queueSize);
  const handlers = new HandlerRegistry();
  const requests = new RequestTracker(config.pendingRequestsLimit);
  const stateCallbacks = new Set<(state: ClientState) => void>();
  let unhandledCallback: ((msg: AnyInboundMessage) => void) | null = null;
  const errorCallbacks = new Set<
    (
      error: Error,
      context: {
        type: "parse" | "validation" | "overflow" | "unknown";
        details?: unknown;
      },
    ) => void
  >();

  // Helper to extract message type from schema
  function extractType(schema: AnyMessageSchema): string {
    // Support both Zod and Valibot schemas
    if (schema.shape?.type?.value) return schema.shape.type.value; // Zod
    if (schema.entries?.type?.literal) return schema.entries.type.literal; // Valibot
    throw new Error("Unable to extract message type from schema");
  }

  // Helper for safeParse (works with both Zod and Valibot)
  function safeParse(
    schema: AnyMessageSchema,
    data: unknown,
  ): { success: boolean; data?: unknown; error?: unknown } {
    return schema.safeParse(data) as {
      success: boolean;
      data?: unknown;
      error?: unknown;
    };
  }

  // State transitions
  function setState(newState: ClientState): void {
    if (state === newState) return;
    state = newState;
    console.debug(`[Client] State: ${state}`);
    for (const cb of Array.from(stateCallbacks)) {
      try {
        cb(state);
      } catch (error) {
        console.error("[Client] State callback error:", error);
      }
    }
  }

  // WebSocket event handlers
  function handleOpen(): void {
    setState("open");
    selectedProtocol = ws?.protocol ?? "";
    reconnectAttempts = 0;

    // Flush queued messages
    if (ws) {
      const flushed = queue.flush(ws);
      if (flushed > 0) {
        console.debug(`[Client] Flushed ${flushed} queued messages`);
      }
    }
  }

  function handleMessage(event: MessageEvent): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch (error) {
      console.warn("[Client] Failed to parse message:", error);
      for (const cb of Array.from(errorCallbacks)) {
        try {
          cb(error instanceof Error ? error : new Error(String(error)), {
            type: "parse",
            details: event.data,
          });
        } catch (cbError) {
          console.error("[Client] Error callback failed:", cbError);
        }
      }
      return;
    }

    // Type guard to ensure parsed is an object with meta
    const hasCorrelationId =
      parsed &&
      typeof parsed === "object" &&
      "meta" in parsed &&
      parsed.meta &&
      typeof parsed.meta === "object" &&
      "correlationId" in parsed.meta;

    // Check for correlationId (request/response)
    if (hasCorrelationId) {
      requests.handleReply(parsed, safeParse);
      // Note: reply might also trigger schema handlers (not mutually exclusive)
    }

    // Validate against registered schema
    const validationResult = handlers.validate(parsed, safeParse);

    if (validationResult.success) {
      // Validation succeeded - dispatch to schema handlers
      const handled = handlers.dispatch(
        validationResult.data as { type: string; [key: string]: unknown },
      );
      if (!handled && unhandledCallback) {
        // No schema handler found, invoke onUnhandled
        unhandledCallback(validationResult.data as AnyInboundMessage);
      }
    } else {
      // Validation failed or no schema registered
      const failureResult = validationResult as
        | { success: false; reason: "no-schema" }
        | { success: false; reason: "validation-failed"; error: unknown };

      if (failureResult.reason === "validation-failed") {
        // Validation failed - drop message (do NOT pass to onUnhandled)
        // Already logged warning in handlers.validate()
        for (const cb of Array.from(errorCallbacks)) {
          try {
            cb(new Error("Message validation failed"), {
              type: "validation",
              details: { message: parsed, errors: failureResult.error },
            });
          } catch (cbError) {
            console.error("[Client] Error callback failed:", cbError);
          }
        }
      } else {
        // No schema registered - check if structurally valid for onUnhandled
        if (
          parsed &&
          typeof parsed === "object" &&
          "type" in parsed &&
          typeof parsed.type === "string"
        ) {
          if (unhandledCallback) {
            unhandledCallback(parsed as AnyInboundMessage);
          }
        } else {
          console.warn("[Client] Invalid message structure:", parsed);
          for (const cb of Array.from(errorCallbacks)) {
            try {
              cb(new Error("Invalid message structure"), {
                type: "validation",
                details: parsed,
              });
            } catch (cbError) {
              console.error("[Client] Error callback failed:", cbError);
            }
          }
        }
      }
    }
  }

  function handleError(event: Event): void {
    console.error("[Client] WebSocket error:", event);
  }

  function handleClose(event: CloseEvent): void {
    console.debug(
      `[Client] WebSocket closed: ${event.code} ${event.reason || "(no reason)"}`,
    );

    // Cleanup
    ws = null;
    selectedProtocol = "";

    // Reject pending requests
    requests.rejectAll();

    // Decide next state
    if (manualClose) {
      setState("closed");
      return;
    }

    if (
      config.reconnect.enabled &&
      reconnectAttempts < config.reconnect.maxAttempts
    ) {
      setState("reconnecting");
      scheduleReconnect();
    } else {
      setState("closed");
    }
  }

  function scheduleReconnect(): void {
    reconnectAttempts++;
    const delay = calculateBackoff(reconnectAttempts, {
      initialDelayMs: config.reconnect.initialDelayMs,
      maxDelayMs: config.reconnect.maxDelayMs,
      jitter: config.reconnect.jitter as "full" | "none",
    });

    console.debug(
      `[Client] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`,
    );

    reconnectTimeoutId = setTimeout(() => {
      reconnectTimeoutId = null;
      connect().catch((error) => {
        console.error("[Client] Reconnect failed:", error);
      });
    }, delay);
  }

  // Public API

  async function connect(): Promise<void> {
    // Idempotent: return in-flight promise if connecting
    if (connectPromise) return connectPromise;

    // Already open
    if (state === "open") return Promise.resolve();

    connectPromise = (async () => {
      try {
        setState("connecting");
        manualClose = false; // Reset manual close flag
        everAttemptedConnect = true; // Mark that we've attempted connection

        // Get auth token
        const token = await getAuthToken(config.auth.getToken);

        // Build URL with auth token (if query mode)
        let url: string | URL = config.url;
        if (config.auth.attach === "query" && token) {
          url = attachTokenToUrl(url, token, config.auth.queryParam);
        }

        // Build protocols with auth token (if protocol mode)
        const protocols =
          config.auth.attach === "protocol"
            ? mergeProtocols(
                config.protocols,
                token,
                config.auth.protocolPrefix,
                config.auth.protocolPosition,
              )
            : config.protocols;

        // Create WebSocket
        ws = config.wsFactory(url, protocols);
        ws.onopen = handleOpen;
        ws.onmessage = handleMessage;
        ws.onerror = handleError;
        ws.onclose = handleClose;

        // Wait for open or error
        await new Promise<void>((resolve, reject) => {
          const openHandler = () => {
            cleanup();
            resolve();
          };
          const errorHandler = () => {
            cleanup();
            reject(new Error("WebSocket connection failed"));
          };
          const closeHandler = (event: CloseEvent) => {
            cleanup();
            reject(
              new Error(
                `WebSocket closed during connection: ${event.code} ${event.reason || ""}`,
              ),
            );
          };

          function cleanup() {
            ws?.removeEventListener("open", openHandler);
            ws?.removeEventListener("error", errorHandler);
            ws?.removeEventListener("close", closeHandler);
          }

          ws?.addEventListener("open", openHandler);
          ws?.addEventListener("error", errorHandler);
          ws?.addEventListener("close", closeHandler);
        });
      } catch (error) {
        // Connection failed - transition to closed state
        setState("closed");
        throw error;
      } finally {
        connectPromise = null;
      }
    })();

    return connectPromise;
  }

  async function close(opts?: {
    code?: number;
    reason?: string;
  }): Promise<void> {
    // Fully idempotent - safe to call in any state
    manualClose = true;

    // Cancel reconnect
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }

    // Clear queue
    queue.clear();

    // Reject pending requests
    requests.rejectAll();

    // Close WebSocket if exists
    if (ws && (state === "open" || state === "connecting")) {
      setState("closing");
      ws.close(opts?.code ?? 1000, opts?.reason ?? "");

      // Wait for close event
      await new Promise<void>((resolve) => {
        const checkClosed = () => {
          if (state === "closed") {
            resolve();
          } else {
            setTimeout(checkClosed, 10);
          }
        };
        checkClosed();
      });
    } else {
      setState("closed");
    }
  }

  function onState(cb: (state: ClientState) => void): () => void {
    stateCallbacks.add(cb);
    return () => stateCallbacks.delete(cb);
  }

  function onceOpen(): Promise<void> {
    if (state === "open") return Promise.resolve();

    return new Promise((resolve) => {
      const unsub = onState((s) => {
        if (s === "open") {
          unsub();
          resolve();
        }
      });
    });
  }

  function on<S extends AnyMessageSchema>(
    schema: S,
    handler: MessageHandler,
  ): () => void {
    return handlers.register(schema, handler, extractType);
  }

  function send<S extends AnyMessageSchema>(
    schema: S,
    payload: unknown,
    opts?: { meta?: Record<string, unknown>; correlationId?: string },
  ): boolean {
    // Auto-connect if enabled and never attempted
    if (config.autoConnect && state === "closed" && !everAttemptedConnect) {
      connect().catch((error) => {
        console.error("[Client] Auto-connect failed:", error);
      });
    }

    // Strip reserved + managed keys from user meta
    const userMeta = opts?.meta ? { ...opts.meta } : {};
    for (const key of Array.from(RESERVED_MANAGED_META_KEYS)) {
      Reflect.deleteProperty(userMeta, key);
    }

    // Normalize meta
    const meta = normalizeOutboundMeta(userMeta, opts?.correlationId);

    // Build message
    const type = extractType(schema);
    const message = {
      type,
      meta,
      ...(payload !== undefined && { payload }),
    };

    // Validate
    const result = safeParse(schema, message);
    if (!result.success) {
      console.error("[Client] Validation failed:", result.error);
      return false;
    }

    // Serialize
    const serialized = JSON.stringify(result.data);

    // Send or queue
    if (state === "open" && ws) {
      ws.send(serialized);
      return true;
    } else {
      return queue.enqueue(serialized);
    }
  }

  function request<S extends AnyMessageSchema, R extends AnyMessageSchema>(
    schema: S,
    payload: unknown,
    reply: R,
    opts?: {
      timeoutMs?: number;
      meta?: Record<string, unknown>;
      correlationId?: string;
    },
  ): Promise<unknown> {
    // Auto-connect if enabled and never attempted
    if (config.autoConnect && state === "closed" && !everAttemptedConnect) {
      return connect()
        .then(() => requestImpl(schema, payload, reply, opts))
        .catch((error) => {
          // Auto-connect failed - reject
          return Promise.reject(error);
        });
    }

    return requestImpl(schema, payload, reply, opts);
  }

  function requestImpl<S extends AnyMessageSchema, R extends AnyMessageSchema>(
    schema: S,
    payload: unknown,
    reply: R,
    opts?: {
      timeoutMs?: number;
      meta?: Record<string, unknown>;
      correlationId?: string;
      signal?: AbortSignal;
    },
  ): Promise<unknown> {
    const timeoutMs = opts?.timeoutMs ?? 30000;

    // Generate correlationId if not provided
    const correlationId = opts?.correlationId ?? crypto.randomUUID();

    // Strip reserved + managed keys from user meta
    const userMeta = opts?.meta ? { ...opts.meta } : {};
    for (const key of Array.from(RESERVED_MANAGED_META_KEYS)) {
      Reflect.deleteProperty(userMeta, key);
    }

    // Normalize meta
    const meta = normalizeOutboundMeta(userMeta, correlationId);

    // Build message
    const type = extractType(schema);
    const message = {
      type,
      meta,
      ...(payload !== undefined && { payload }),
    };

    // Validate outbound message
    const result = safeParse(schema, message);
    if (!result.success) {
      return Promise.reject(
        new StateError(
          `Outbound validation failed: ${JSON.stringify(result.error)}`,
        ),
      );
    }

    // Serialize
    const serialized = JSON.stringify(result.data);

    // Check if can send immediately or need to queue
    if (state !== "open") {
      if (config.queue === "off") {
        return Promise.reject(
          new StateError(
            "Cannot send request while disconnected with queue disabled",
          ),
        );
      }
      // Will queue and timeout starts after flush
    }

    // Register pending request
    const expectedType = extractType(reply);
    const requestPromise = requests.register(
      correlationId,
      expectedType,
      reply,
      timeoutMs,
      () => {
        // onFlush callback - send message
        if (state === "open" && ws) {
          ws.send(serialized);
        } else {
          queue.enqueue(serialized);
        }
      },
      opts?.signal,
    );

    return requestPromise;
  }

  function onUnhandled(cb: (msg: AnyInboundMessage) => void): () => void {
    unhandledCallback = cb;
    return () => {
      unhandledCallback = null;
    };
  }

  function onError(
    cb: (
      error: Error,
      context: {
        type: "parse" | "validation" | "overflow" | "unknown";
        details?: unknown;
      },
    ) => void,
  ): () => void {
    errorCallbacks.add(cb);
    queue.setOverflowCallback(cb);
    return () => {
      errorCallbacks.delete(cb);
      queue.removeOverflowCallback(cb);
    };
  }

  // Return client interface
  return {
    get state() {
      return state;
    },
    get isConnected() {
      return state === "open";
    },
    get protocol() {
      return selectedProtocol;
    },
    connect,
    close,
    onState,
    onceOpen,
    on,
    send,
    request,
    onUnhandled,
    onError,
  };
}
