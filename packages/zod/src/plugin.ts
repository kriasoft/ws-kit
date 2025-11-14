// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * withZod() plugin: adds validation capability to the router.
 *
 * Once plugged, the router gains:
 * - router.rpc() method for request-response handlers
 * - Enhanced context: ctx.payload (validated), ctx.send(), ctx.reply(), ctx.progress()
 * - Automatic payload validation from schemas
 * - Validation errors routed to router.onError()
 */

import type {
  ConnectionData,
  MessageDescriptor,
  MinimalContext,
  ProgressOptions as CoreProgressOptions,
  ReplyOptions as CoreReplyOptions,
  SendOptions,
} from "@ws-kit/core";
import { getRouteIndex } from "@ws-kit/core";
import { getRouterPluginAPI } from "@ws-kit/core/internal";
import { definePlugin } from "@ws-kit/core/plugin";
import { getZodPayload, validatePayload } from "./internal.js";
import { getSchemaOpts, typeOf, type SchemaOpts } from "./metadata.js";
import type { AnySchema, InferPayload } from "./types.js";

interface WsContext {
  kind?: string; // "event" | "rpc" if set by schema registry
  request: any; // root message schema (Zod object with safeParse)
  response?: any; // only set for RPC (Zod object with safeParse)
}

/**
 * Enhanced context type for type-safe internal mutations.
 * @internal
 */
type EnhancedContext = MinimalContext<any> & {
  payload?: unknown;
  __wskit?: WsContext;
  __connData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  send?: (
    schema: AnySchema | MessageDescriptor,
    payload: any,
    opts?: SendOptions,
  ) => void | Promise<boolean>;
  reply?: (payload: any, opts?: any) => void | Promise<void>;
  error?: (
    code: string,
    message: string,
    details?: any,
    opts?: any,
  ) => void | Promise<void>;
  progress?: (payload: any, opts?: any) => void | Promise<void>;
  getData?: (key: string) => unknown;
};

export interface WithZodOptions {
  /**
   * Validate outgoing payloads (send, reply, publish).
   * Default: true
   * Set to false for ultra-hot paths where performance is critical.
   * Per-schema override: message({..., options: { validateOutgoing: false }})
   */
  validateOutgoing?: boolean;

  /**
   * Hook for validation errors (inbound/outbound).
   * If provided, called instead of routing to router.onError().
   */
  onValidationError?: (
    error: Error & { code: string; details: any },
    context: {
      type: string;
      direction: "inbound" | "outbound";
      payload: unknown;
    },
  ) => void | Promise<void>;
}

/**
 * Resolved effective options combining plugin defaults and per-schema overrides.
 * @internal
 */
interface ResolvedOptions {
  validateOutgoing: boolean;
}

export interface ReplyOptions extends CoreReplyOptions {
  /**
   * Whether to validate the outgoing payload.
   * Default: uses plugin validateOutgoing setting
   */
  validate?: boolean;
}

export interface ProgressOptions extends CoreProgressOptions {
  /**
   * Whether to validate the outgoing payload.
   * Default: uses plugin validateOutgoing setting
   */
  validate?: boolean;
}

/**
 * Validation plugin for Zod schemas.
 * Adds validation capability and RPC support to the router.
 *
 * Inserts a validation middleware that:
 * 1. Validates inbound payload from schema (always using safeParse)
 * 2. Enriches context with payload and methods (send, reply, progress)
 * 3. Optionally validates outgoing payloads
 * 4. Routes validation errors to router.onError() or custom onValidationError hook
 *
 * @example
 * ```typescript
 * const router = createRouter()
 *   .plugin(withZod({ validateOutgoing: true }))
 *   .on(Join, (ctx) => {
 *     // ctx.payload is now typed and validated
 *     console.log(ctx.payload.roomId);
 *   })
 *   .rpc(GetUser, async (ctx) => {
 *     // RPC handler: has ctx.reply() and ctx.progress()
 *     ctx.progress({ id: ctx.payload.id, name: "Loading..." });
 *     ctx.reply({ id: ctx.payload.id, name: "Alice" });
 *   });
 * ```
 */
/**
 * Helper to format Zod errors for better DX.
 * @internal
 */
function formatValidationError(error: any): string {
  if (error.flatten) {
    const flat = error.flatten();
    const issues = [
      ...(flat.formErrors || []),
      ...Object.entries(flat.fieldErrors || {}).flatMap(
        ([field, msgs]: [string, any]) =>
          (msgs || []).map((m: any) => `${field}: ${m}`),
      ),
    ];
    return issues.length > 0 ? issues.join("; ") : JSON.stringify(error);
  }
  return JSON.stringify(error);
}

/**
 * Helper to resolve effective options, preferring per-schema over plugin defaults.
 * @internal
 */
function resolveOptions(
  schemaOpts: SchemaOpts | undefined,
  pluginOpts: Required<Omit<WithZodOptions, "onValidationError">>,
): ResolvedOptions {
  return {
    validateOutgoing:
      schemaOpts?.validateOutgoing ?? pluginOpts.validateOutgoing ?? true,
  };
}

/**
 * Validation plugin API interface with capability marker.
 * Added to the router when withZod() is applied.
 *
 * The { validation: true } marker enables Router type narrowing:
 * - Before plugin: Router<TContext, {}> → keyof excludes rpc()
 * - After plugin: Router<TContext, { validation: true }> → keyof includes rpc()
 */
interface WithZodValidationAPI<
  TContext extends ConnectionData = ConnectionData,
> {
  /**
   * Marker for capability-gating in Router type system.
   * @internal
   */
  readonly validation: true;

  /**
   * Register an RPC handler with request-response pattern.
   * Automatically infers context type from schema without explicit casting.
   * @param schema RPC message schema with request and response types
   * @param handler RPC handler function with inferred context type
   * @example
   * const GetUser = rpc("GET_USER", { id: z.string() }, "USER", { name: z.string() });
   * router.rpc(GetUser, (ctx) => {
   *   // ctx is automatically typed as RpcContext<TContext, { id: string }, { name: string }>
   *   ctx.reply({ name: "Alice" });
   * });
   */
  rpc<S extends AnySchema>(
    schema: S & { response?: AnySchema },
    handler: (
      ctx: S extends { response: infer R }
        ? R extends AnySchema
          ? import("@ws-kit/core").RpcContext<
              TContext,
              InferPayload<S>,
              InferPayload<R>
            >
          : never
        : never,
    ) => void | Promise<void>,
  ): any; // Returns Router<TContext, any> (type system enforces via plugin mechanism)
}

export function withZod<TContext extends ConnectionData = ConnectionData>(
  options?: WithZodOptions,
) {
  const pluginOpts = {
    validateOutgoing: options?.validateOutgoing ?? true,
    onValidationError: options?.onValidationError,
  };

  return definePlugin<TContext, WithZodValidationAPI<TContext>>((router) => {
    // Get plugin API for registering enhancers
    const api = getRouterPluginAPI(router);

    // Inject validation middleware that validates root message and enriches context
    // This runs automatically before any user handler
    router.use(async (ctx: MinimalContext<any>, next: () => Promise<void>) => {
      // Capture lifecycle for use in error handlers
      const lifecycle = api.getLifecycle();

      // Get the schema from route index by looking up the type
      const routeIndex = getRouteIndex(router);
      const schemaInfo = routeIndex.get(ctx.type);

      if (schemaInfo) {
        const schema = schemaInfo.schema as any;
        const enhCtx = ctx as EnhancedContext;

        // If schema is a Zod object (has safeParse), validate the full root message
        if (typeof schema?.safeParse === "function") {
          // Get per-schema options and resolve effective options
          const schemaOpts = getSchemaOpts(schema);
          const eff = resolveOptions(schemaOpts, pluginOpts);

          // Construct normalized inbound message
          const inboundMessage = {
            type: ctx.type,
            meta: enhCtx.meta || {},
            ...(enhCtx.payload !== undefined
              ? { payload: enhCtx.payload }
              : {}),
          };

          // Validate against root schema (enforces strict type, meta, payload)
          // Always use safeParse for consistent error handling.
          // Coercion is controlled by schema design (z.coerce.*), not runtime flags.
          const result = schema.safeParse(inboundMessage);

          if (!result.success) {
            // Create validation error and route to error sink
            const validationError = new Error(
              `Validation failed for ${ctx.type}: ${formatValidationError(result.error)}`,
            ) as unknown as Error & { code: string; details: any };
            validationError.code = "VALIDATION_ERROR";
            validationError.details = result.error;

            // Call custom hook if provided, otherwise route to error handler
            if (pluginOpts.onValidationError) {
              await pluginOpts.onValidationError(validationError, {
                type: ctx.type,
                direction: "inbound",
                payload: enhCtx.payload,
              });
            } else {
              await lifecycle.handleError(validationError, ctx);
            }
            return;
          }

          // Enrich context with validated payload (extracted from root validation)
          if (result.data.payload !== undefined) {
            enhCtx.payload = result.data.payload;
          }

          // Stash schema info for later use in reply/progress/send
          enhCtx.__wskit = {
            kind: (schemaInfo.schema as any).kind, // may be undefined; that's ok
            request: schema,
            response: schema.response,
          };
        }
      }

      // Continue with enriched context
      await next();
    });

    // Register context enhancer to attach send/reply/progress methods
    api.addContextEnhancer(
      (ctx: MinimalContext<any>) => {
        const enhCtx = ctx as EnhancedContext;
        // Capture lifecycle for use in nested functions
        const lifecycle = api.getLifecycle();

        // Track reply idempotency
        let replied = false;

        // Track throttle state for progress updates
        let lastProgressTime = 0;

        // Guard: ensure we're in an RPC context
        function guardRpc() {
          const wskit = enhCtx.__wskit;
          if (!wskit?.response) {
            throw new Error(
              "ctx.reply() and ctx.progress() are only available in RPC handlers",
            );
          }
          return wskit;
        }

        // Extract base metadata from request (preserves correlationId)
        function baseMeta(enhCtx: EnhancedContext): Record<string, unknown> {
          return {
            correlationId: enhCtx.meta?.correlationId,
          };
        }

        // Sanitize user-provided meta: strip reserved keys
        function sanitizeMeta(
          userMeta: Record<string, unknown> | undefined,
        ): Record<string, unknown> {
          if (!userMeta) return {};
          const sanitized = { ...userMeta };
          // Strip reserved keys that cannot be overridden
          delete sanitized.type;
          delete sanitized.correlationId;
          return sanitized;
        }

        // Helper: check if we should throttle based on lastProgressTime
        function shouldThrottle(throttleMs: number | undefined): boolean {
          if (!throttleMs) return false;
          const now = Date.now();
          const timeSinceLastProgress = now - lastProgressTime;
          if (timeSinceLastProgress >= throttleMs) {
            lastProgressTime = now;
            return false; // Don't throttle, send immediately
          }
          return true; // Throttle, skip this send
        }

        // Helper to validate outgoing message (full root validation)
        const validateOutgoingPayload = async (
          schema: AnySchema | MessageDescriptor,
          payload: any,
        ): Promise<any> => {
          // Get per-schema options and resolve effective options for this schema
          const schemaOpts =
            typeof schema === "object" ? getSchemaOpts(schema) : undefined;
          const eff = resolveOptions(schemaOpts, pluginOpts);

          if (!eff.validateOutgoing) {
            return payload;
          }

          const schemaObj = schema as any;

          // If schema has safeParse, validate full root message
          if (typeof schemaObj?.safeParse === "function") {
            // Construct outbound message
            const outboundMessage = {
              type: typeOf(schemaObj, schema),
              meta: {},
              ...(payload !== undefined ? { payload } : {}),
            };

            const result = schemaObj.safeParse(outboundMessage);
            if (!result.success) {
              const validationError = new Error(
                `Outbound validation failed for ${schema.type}: ${formatValidationError(result.error)}`,
              ) as unknown as Error & { code: string; details: any };
              validationError.code = "OUTBOUND_VALIDATION_ERROR";
              validationError.details = result.error;

              if (pluginOpts.onValidationError) {
                await pluginOpts.onValidationError(validationError, {
                  type: schema.type,
                  direction: "outbound",
                  payload,
                });
              } else {
                await lifecycle.handleError(validationError, ctx);
              }
              throw validationError;
            }

            return result.data.payload ?? payload;
          }

          // Fallback for schemas that don't have safeParse (e.g., legacy message descriptors).
          // In normal usage with message() and rpc() builders, this branch is never reached.
          // This path exists for edge cases where schemas are constructed manually.
          const payloadSchema = getZodPayload(schema);
          if (!payloadSchema) {
            // Non-Zod schema without payload metadata—skip validation
            return payload;
          }

          const result = validatePayload(payload, payloadSchema);
          if (!result.success) {
            const validationError = new Error(
              `Outbound validation failed for ${schema.type}: ${formatValidationError(result.error)}`,
            ) as unknown as Error & { code: string; details: any };
            validationError.code = "OUTBOUND_VALIDATION_ERROR";
            validationError.details = result.error;

            if (pluginOpts.onValidationError) {
              await pluginOpts.onValidationError(validationError, {
                type: schema.type,
                direction: "outbound",
                payload,
              });
            } else {
              await lifecycle.handleError(validationError, ctx);
            }
            throw validationError;
          }

          return result.data ?? payload;
        };

        // Helper: serialize and send an outbound message
        const sendMessage = (
          type: string,
          payload: any,
          meta: Record<string, unknown>,
        ): void => {
          const message = {
            type,
            meta,
            ...(payload !== undefined ? { payload } : {}),
          };
          try {
            ctx.ws.send(JSON.stringify(message));
          } catch (err) {
            // Connection may have closed; error will be caught by socket wrapper
            const sendError = new Error(
              `Failed to send message ${type}: ${err instanceof Error ? err.message : String(err)}`,
            );
            (sendError as unknown as Error & { code: string }).code =
              "SEND_ERROR";
            lifecycle.handleError(sendError, ctx);
          }
        };

        // Helper: validate payload against RPC response schema
        const validateProgressPayload = async (
          responseSchema: AnySchema,
          progressPayload: any,
        ): Promise<any> => {
          // Get per-schema options and resolve effective options
          const schemaOpts = getSchemaOpts(responseSchema);
          const eff = resolveOptions(schemaOpts, pluginOpts);

          if (!eff.validateOutgoing) {
            return progressPayload;
          }

          // Get the payload schema from the response message schema
          const schemaObj = responseSchema as any;

          if (typeof schemaObj?.safeParse === "function") {
            // Construct a temporary message to validate the payload shape
            const tempMessage = {
              type: schemaObj.responseType || typeOf(schemaObj),
              meta: {},
              ...(progressPayload !== undefined
                ? { payload: progressPayload }
                : {}),
            };

            const result = schemaObj.safeParse(tempMessage);
            if (!result.success) {
              const validationError = new Error(
                `Progress validation failed for ${ctx.type}: ${formatValidationError(result.error)}`,
              ) as unknown as Error & { code: string; details: any };
              validationError.code = "PROGRESS_VALIDATION_ERROR";
              validationError.details = result.error;

              if (pluginOpts.onValidationError) {
                await pluginOpts.onValidationError(validationError, {
                  type: "$ws:rpc-progress",
                  direction: "outbound",
                  payload: progressPayload,
                });
              } else {
                await lifecycle.handleError(validationError, ctx);
              }
              throw validationError;
            }

            return result.data.payload ?? progressPayload;
          }

          return progressPayload;
        };

        // Helper: send outbound message (terminal reply only)
        const sendOutbound = async (
          payload: any,
          replyOpts?: ReplyOptions,
        ): Promise<void> => {
          // Check if signal is already aborted
          if (replyOpts?.signal?.aborted) {
            return;
          }

          const wskit = guardRpc();
          const responseSchema = wskit.response as any;

          // Get per-schema options and determine if validation is enabled
          const schemaOpts = getSchemaOpts(responseSchema);
          const eff = resolveOptions(schemaOpts, pluginOpts);
          const shouldValidate = replyOpts?.validate ?? eff.validateOutgoing;

          // Construct response message with sanitized meta
          const responseMessage = {
            type: responseSchema.responseType || typeOf(responseSchema),
            meta: {
              ...baseMeta(ctx),
              ...sanitizeMeta(replyOpts?.meta),
            },
            ...(payload !== undefined ? { payload } : {}),
          };

          // Validate if enabled
          if (
            shouldValidate &&
            typeof responseSchema?.safeParse === "function"
          ) {
            const result = responseSchema.safeParse(responseMessage);
            if (!result.success) {
              const validationError = new Error(
                `Reply validation failed for ${ctx.type}: ${formatValidationError(result.error)}`,
              ) as unknown as Error & { code: string; details: any };
              validationError.code = "REPLY_VALIDATION_ERROR";
              validationError.details = result.error;

              if (pluginOpts.onValidationError) {
                await pluginOpts.onValidationError(validationError, {
                  type: responseMessage.type,
                  direction: "outbound",
                  payload,
                });
              } else {
                await lifecycle.handleError(validationError, ctx);
              }
              throw validationError;
            }
          }

          // Mark as replied
          replied = true;

          // Send the message via WebSocket
          sendMessage(
            responseMessage.type,
            responseMessage.payload,
            responseMessage.meta,
          );

          // If waitFor specified, return a promise
          if (replyOpts?.waitFor) {
            return new Promise((resolve) => {
              setImmediate(() => resolve());
            });
          }
        };

        // Create Zod extension object with all methods
        const zodExt = {
          // send() method for event handlers (always available after validation)
          send: (
            schema: AnySchema | MessageDescriptor,
            payload: any,
            opts?: SendOptions,
          ): void | Promise<boolean> => {
            // Check if signal is already aborted
            if (opts?.signal?.aborted) {
              return opts?.waitFor ? Promise.resolve(false) : undefined;
            }

            // If no waitFor, return void (fire-and-forget path)
            if (!opts?.waitFor) {
              // Fire-and-forget path
              validateOutgoingPayload(schema, payload)
                .then((validatedPayload) => {
                  // Get message type from schema
                  const messageType =
                    (schema as any).__descriptor?.type ||
                    (schema as any).type ||
                    schema.type;

                  // Build meta: start with sanitized user meta, then add correlation ID
                  let outMeta: Record<string, unknown> = sanitizeMeta(
                    opts?.meta,
                  );

                  // Auto-preserve correlation ID if requested
                  if (opts?.preserveCorrelation && enhCtx.meta?.correlationId) {
                    outMeta.correlationId = enhCtx.meta.correlationId;
                  }

                  // Send the message
                  sendMessage(messageType, validatedPayload, outMeta);
                })
                .catch(() => {
                  // Silently catch errors; validation errors are handled in validateOutgoingPayload
                });
              return undefined;
            }

            // With waitFor, return promise
            return new Promise<boolean>((resolveOuter) => {
              validateOutgoingPayload(schema, payload)
                .then((validatedPayload) => {
                  // Get message type from schema
                  const messageType =
                    (schema as any).__descriptor?.type ||
                    (schema as any).type ||
                    schema.type;

                  // Build meta: start with sanitized user meta, then add correlation ID
                  let outMeta: Record<string, unknown> = sanitizeMeta(
                    opts?.meta,
                  );

                  // Auto-preserve correlation ID if requested
                  if (opts?.preserveCorrelation && enhCtx.meta?.correlationId) {
                    outMeta.correlationId = enhCtx.meta.correlationId;
                  }

                  // Send the message
                  sendMessage(messageType, validatedPayload, outMeta);

                  // If waitFor specified, resolve the promise (stub for now; full impl requires buffer tracking)
                  // TODO: Implement actual buffer drain/ack tracking
                  setImmediate(() => resolveOuter(true));
                })
                .catch(() => {
                  // Silently catch errors; validation errors are handled in validateOutgoingPayload
                  resolveOuter(true);
                });
            });
          },

          // reply() method for RPC handlers
          reply: (payload: any, opts?: any): void | Promise<void> => {
            guardRpc();
            if (replied) {
              // Idempotent: return void or empty promise if already replied
              return opts?.waitFor ? Promise.resolve() : undefined;
            }

            // If no waitFor, return void (fire-and-forget)
            if (!opts?.waitFor) {
              // Fire-and-forget path
              sendOutbound(payload, opts).catch(() => {
                // Silently catch errors; validation errors are handled in sendOutbound
              });
              return undefined;
            }

            // With waitFor, return promise
            return (async () => {
              await sendOutbound(payload, opts);
            })();
          },

          // error() method for RPC handlers (terminal, symmetric with reply())
          error: (
            code: string,
            message: string,
            details?: any,
            opts?: any,
          ): void | Promise<void> => {
            // Check if signal is already aborted
            if (opts?.signal?.aborted) {
              return opts?.waitFor ? Promise.resolve() : undefined;
            }

            const wskit = guardRpc();
            if (replied) {
              // Idempotent: return void or empty promise if already replied
              return opts?.waitFor ? Promise.resolve() : undefined;
            }

            const responseSchema = wskit.response as any;

            // Construct error response message
            const errorMessage = {
              type: "$ws:rpc-error",
              meta: {
                ...baseMeta(enhCtx),
                ...sanitizeMeta(opts?.meta),
              },
              payload: {
                code,
                message,
                ...(details !== undefined ? { details } : {}),
              },
            };

            // Mark as replied (one-shot guard applies to both reply and error)
            replied = true;

            // Send the error message via WebSocket
            sendMessage(
              errorMessage.type,
              errorMessage.payload,
              errorMessage.meta,
            );

            // If waitFor specified, return a promise
            if (opts?.waitFor) {
              return new Promise((resolve) => {
                setImmediate(() => resolve());
              });
            }

            return undefined;
          },

          // progress() method for RPC handlers
          // Emits a dedicated $ws:rpc-progress control message (non-terminal)
          progress: (payload: any, opts?: any): void | Promise<void> => {
            // Check if signal is already aborted
            if (opts?.signal?.aborted) {
              return opts?.waitFor ? Promise.resolve() : undefined;
            }

            const wskit = guardRpc();
            const responseSchema = wskit.response as any;

            // Check if this update should be throttled
            if (shouldThrottle(opts?.throttleMs)) {
              // Throttled: return immediately without sending
              return opts?.waitFor ? Promise.resolve() : undefined;
            }

            // If no waitFor, return void (fire-and-forget)
            if (!opts?.waitFor) {
              // Fire-and-forget path
              validateProgressPayload(responseSchema, payload)
                .then((validatedPayload) => {
                  // Build control message with correlation ID preserved
                  const progressMessage = {
                    type: "$ws:rpc-progress",
                    meta: {
                      ...baseMeta(ctx),
                      ...sanitizeMeta(opts?.meta),
                    },
                    ...(validatedPayload !== undefined
                      ? { payload: validatedPayload }
                      : {}),
                  };

                  // Send control message without marking as replied
                  sendMessage(
                    progressMessage.type,
                    progressMessage.payload,
                    progressMessage.meta,
                  );
                })
                .catch(() => {
                  // Silently catch errors; validation errors are handled in validateProgressPayload
                });
              return undefined;
            }

            // With waitFor, return promise
            return (async () => {
              // Validate progress payload against RPC response schema
              const validatedPayload = await validateProgressPayload(
                responseSchema,
                payload,
              );

              // Build control message with correlation ID preserved
              const progressMessage = {
                type: "$ws:rpc-progress",
                meta: {
                  ...baseMeta(ctx),
                  ...sanitizeMeta(opts?.meta),
                },
                ...(validatedPayload !== undefined
                  ? { payload: validatedPayload }
                  : {}),
              };

              // Send control message without marking as replied
              sendMessage(
                progressMessage.type,
                progressMessage.payload,
                progressMessage.meta,
              );

              // If waitFor specified, return a promise
              if (opts?.waitFor) {
                return new Promise((resolve) => {
                  setImmediate(() => resolve());
                });
              }
            })();
          },

          // getData() method - retrieve connection data
          getData: (key: string): unknown => {
            // Access per-connection data store (stored on the socket/connection object)
            // The adapter is responsible for maintaining this store
            const store = enhCtx.__connData || {};
            return store[key];
          },

          // assignData() method - merge partial connection data
          assignData: (partial: Record<string, unknown>): void => {
            // Initialize per-connection data store if not present
            if (!enhCtx.__connData) {
              enhCtx.__connData = {};
            }
            // Shallow merge the provided data
            Object.assign(enhCtx.__connData, partial);
            // TODO: Emit "data changed" event for adapters to persist if needed
          },
        };

        // Store extension in context
        ctx.extensions.set("zod", zodExt);

        // Also expose methods directly on context for backwards compatibility
        enhCtx.send = zodExt.send;
        enhCtx.reply = zodExt.reply;
        enhCtx.error = zodExt.error;
        enhCtx.progress = zodExt.progress;
        enhCtx.getData = zodExt.getData;
        enhCtx.assignData = zodExt.assignData;
      },
      { priority: -100 },
    );

    // Type-safe RPC handler method with automatic context type inference
    const rpcMethod = <S extends AnySchema>(
      schema: S & { response?: AnySchema },
      handler: (
        ctx: S extends { response: infer R }
          ? R extends AnySchema
            ? import("@ws-kit/core").RpcContext<
                TContext,
                InferPayload<S>,
                InferPayload<R>
              >
            : never
          : never,
      ) => void | Promise<void>,
    ) => {
      // Use the standard on() method but mark it internally as RPC-capable
      return router.on(schema as any, handler as any);
    };

    // Return the plugin API extensions with capability marker
    return {
      validation: true as const,
      rpc: rpcMethod,
    };
  });
}
