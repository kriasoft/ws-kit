// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * withValibot() plugin: adds validation capability to the router.
 *
 * Once plugged, the router gains:
 * - router.rpc() method for request-response handlers
 * - Enhanced context: ctx.payload (validated), ctx.send(), ctx.reply(), ctx.progress()
 * - Automatic payload validation from schemas
 * - Validation errors routed to router.onError()
 */

import type {
  Router,
  MessageDescriptor,
  Plugin,
  MinimalContext,
  CoreRouter,
} from "@ws-kit/core";
import { getValibotPayload, validatePayload } from "./internal.js";
import { getSchemaOpts, typeOf, type SchemaOpts } from "./metadata.js";
import type { AnySchema } from "./types.js";

interface WsContext {
  kind?: string; // "event" | "rpc" if set by schema registry
  request: AnySchema; // root message schema
  response?: AnySchema; // only set for RPC
}

export interface WithValibotOptions {
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

export interface ReplyOptions {
  /**
   * Whether to validate the outgoing payload.
   * Default: uses plugin validateOutgoing setting
   */
  validate?: boolean;

  /**
   * Additional metadata to merge into response meta.
   * Reserved keys (type, correlationId) are immutable and cannot be overridden.
   */
  meta?: Record<string, unknown>;
}

/**
 * Validation plugin for Valibot schemas.
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
 * import { v, message, withValibot, createRouter } from "@ws-kit/valibot";
 *
 * const Join = message("JOIN", { roomId: v.string() });
 * const GetUser = rpc("GET_USER", { id: v.string() }, "USER", {
 *   id: v.string(),
 *   name: v.string(),
 * });
 *
 * const router = createRouter()
 *   .plugin(withValibot({ validateOutgoing: true }))
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
 * Helper to resolve effective options, preferring per-schema over plugin defaults.
 * @internal
 */
function resolveOptions(
  schemaOpts: SchemaOpts | undefined,
  pluginOpts: Required<Omit<WithValibotOptions, "onValidationError">>,
): ResolvedOptions {
  return {
    validateOutgoing:
      schemaOpts?.validateOutgoing ?? pluginOpts.validateOutgoing ?? true,
  };
}

export function withValibot(
  options?: WithValibotOptions,
): Plugin<any, { validation: true }> {
  const pluginOpts = {
    validateOutgoing: options?.validateOutgoing ?? true,
    onValidationError: options?.onValidationError,
  };
  return (router) => {
    // Get internal access to router for wrapping dispatch
    const routerImpl = router as any as CoreRouter<any>;

    // Store original context creator
    const originalCreateContext = routerImpl.createContext.bind(routerImpl);

    // Inject validation middleware that validates root message and enriches context
    // This runs automatically before any user handler
    router.use(async (ctx: MinimalContext<any>, next) => {
      // Get the schema from registry by looking up the type
      const registry = routerImpl.getInternalRegistry();
      const entry = registry.get(ctx.type);

      if (entry) {
        const schema = entry.schema as any;

        // If schema has safeParse (Valibot), validate the full root message
        if (typeof schema?.safeParse === "function") {
          // Construct normalized inbound message
          const inboundMessage = {
            type: ctx.type,
            meta: ctx.meta || {},
            ...(ctx.payload !== undefined ? { payload: ctx.payload } : {}),
          };

          // Validate against root schema (enforces strict type, meta, payload)
          // Always use safeParse for consistent error handling.
          // Coercion is controlled by schema design, not runtime flags.
          const result = schema.safeParse(inboundMessage);
          if (!result.success) {
            // Create validation error and route to error sink
            const validationError = new Error(
              `Validation failed for ${ctx.type}: ${JSON.stringify(result.error)}`,
            );
            (validationError as any).code = "VALIDATION_ERROR";
            (validationError as any).details = result.error;

            // Call custom hook if provided, otherwise route to error handler
            if (pluginOpts.onValidationError) {
              await pluginOpts.onValidationError(validationError, {
                type: ctx.type,
                direction: "inbound",
                payload: ctx.payload,
              });
            } else {
              const lifecycle = routerImpl.getInternalLifecycle();
              await lifecycle.handleError(validationError, ctx);
            }
            return;
          }

          // Enrich context with validated payload (extracted from root validation)
          if (result.data.payload !== undefined) {
            (ctx as any).payload = result.data.payload;
          }

          // Stash schema info for later use in reply/progress/send
          (ctx as any).__wskit = {
            kind: (entry as any).kind, // may be undefined; that's ok
            request: schema,
            response: (schema as any).response,
          } as WsContext;
        }
      }

      // Continue with enriched context
      await next();
    });

    // Wrap the original createContext to attach send/reply/progress methods
    routerImpl.createContext = function (params: any) {
      const ctx = originalCreateContext(params);
      const routerImpl = this as CoreRouter<any>;

      // Track reply idempotency
      let replied = false;

      // Guard: ensure we're in an RPC context
      function guardRpc() {
        const wskit = (ctx as any).__wskit as WsContext | undefined;
        if (!wskit?.response) {
          throw new Error(
            "ctx.reply() and ctx.progress() are only available in RPC handlers",
          );
        }
        return wskit;
      }

      // Extract base metadata from request (preserves correlationId)
      function baseMeta(ctx: any): Record<string, unknown> {
        return {
          correlationId: ctx.meta?.correlationId,
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
              `Outbound validation failed for ${schema.type}: ${JSON.stringify(result.error)}`,
            );
            (validationError as any).code = "OUTBOUND_VALIDATION_ERROR";
            (validationError as any).details = result.error;

            if (pluginOpts.onValidationError) {
              await pluginOpts.onValidationError(validationError, {
                type: schema.type,
                direction: "outbound",
                payload,
              });
            } else {
              const lifecycle = routerImpl.getInternalLifecycle();
              await lifecycle.handleError(validationError, ctx);
            }
            throw validationError;
          }

          return result.data.payload ?? payload;
        }

        // Fallback for non-Valibot schemas (legacy path)
        const payloadSchema = getValibotPayload(schema);
        if (!payloadSchema) {
          return payload;
        }

        const result = validatePayload(payload, payloadSchema);
        if (!result.success) {
          const validationError = new Error(
            `Outbound validation failed for ${schema.type}: ${JSON.stringify(result.error)}`,
          );
          (validationError as any).code = "OUTBOUND_VALIDATION_ERROR";
          (validationError as any).details = result.error;

          if (pluginOpts.onValidationError) {
            await pluginOpts.onValidationError(validationError, {
              type: schema.type,
              direction: "outbound",
              payload,
            });
          } else {
            const lifecycle = routerImpl.getInternalLifecycle();
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
          (sendError as any).code = "SEND_ERROR";
          const lifecycle = routerImpl.getInternalLifecycle();
          lifecycle.handleError(sendError, ctx);
        }
      };

      // Attach send() method for event handlers (always available after validation)
      (ctx as any).send = async (
        schema: AnySchema | MessageDescriptor,
        payload: any,
      ) => {
        // Validate outgoing payload
        const validatedPayload = await validateOutgoingPayload(schema, payload);

        // Get message type from schema
        const messageType =
          (schema as any).__descriptor?.type ||
          (schema as any).type ||
          schema.type;

        // Send with no meta
        sendMessage(messageType, validatedPayload, {});
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
              `Progress validation failed for ${ctx.type}: ${JSON.stringify(result.error)}`,
            );
            (validationError as any).code = "PROGRESS_VALIDATION_ERROR";
            (validationError as any).details = result.error;

            if (pluginOpts.onValidationError) {
              await pluginOpts.onValidationError(validationError, {
                type: "$ws:rpc-progress",
                direction: "outbound",
                payload: progressPayload,
              });
            } else {
              const lifecycle = routerImpl.getInternalLifecycle();
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
        if (shouldValidate && typeof responseSchema?.safeParse === "function") {
          const result = responseSchema.safeParse(responseMessage);
          if (!result.success) {
            const validationError = new Error(
              `Reply validation failed for ${ctx.type}: ${JSON.stringify(result.error)}`,
            );
            (validationError as any).code = "REPLY_VALIDATION_ERROR";
            (validationError as any).details = result.error;

            if (pluginOpts.onValidationError) {
              await pluginOpts.onValidationError(validationError, {
                type: responseMessage.type,
                direction: "outbound",
                payload,
              });
            } else {
              const lifecycle = routerImpl.getInternalLifecycle();
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
      };

      // Attach reply() method for RPC handlers
      (ctx as any).reply = async (payload: any, opts?: ReplyOptions) => {
        guardRpc();
        if (replied) return; // Idempotent: silently ignore if already replied
        await sendOutbound(payload, opts);
      };

      // Attach progress() method for RPC handlers
      // Emits a dedicated $ws:rpc-progress control message (non-terminal)
      (ctx as any).progress = async (payload: any, opts?: ReplyOptions) => {
        const wskit = guardRpc();
        const responseSchema = wskit.response as any;

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
      };

      // Attach getData() method - retrieve connection data
      (ctx as any).getData = (key: string): unknown => {
        // Access per-connection data store (stored on the socket/connection object)
        // The adapter is responsible for maintaining this store
        const store = (ctx as any).__connData || {};
        return store[key];
      };

      // Attach assignData() method - merge partial connection data
      (ctx as any).assignData = (partial: Record<string, unknown>): void => {
        // Initialize per-connection data store if not present
        if (!(ctx as any).__connData) {
          (ctx as any).__connData = {};
        }
        // Shallow merge the provided data
        Object.assign((ctx as any).__connData, partial);
        // TODO: Emit "data changed" event for adapters to persist if needed
      };

      return ctx;
    };

    // Type-safe RPC handler method
    const rpcMethod = (
      schema: MessageDescriptor & { response: MessageDescriptor },
      handler: any,
    ) => {
      // Use the standard on() method but mark it internally as RPC-capable
      return router.on(schema, handler);
    };

    // Return router with rpc method added (capability-gated)
    const enhanced = Object.assign(router, {
      rpc: rpcMethod,
    }) as Router<any, { validation: true }>;

    // Attach capabilities for PluginManager to track
    (enhanced as any).__caps = { validation: true };

    return enhanced;
  };
}
