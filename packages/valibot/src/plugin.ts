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

export interface WithValibotOptions {
  /**
   * Whether to validate outgoing payloads (send, reply, publish).
   * Default: true
   * Set to false for ultra-hot paths where performance is critical.
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
 * Validation plugin for Valibot schemas.
 * Adds validation capability and RPC support to the router.
 *
 * Inserts a validation middleware that:
 * 1. Parses and validates inbound payload from schema
 * 2. Enriches context with payload and methods (send, reply, progress)
 * 3. Optionally validates outbound payloads
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
export function withValibot(
  options?: WithValibotOptions,
): Plugin<any, { validation: true }> {
  const opts: Required<WithValibotOptions> = {
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
          const result = schema.safeParse(inboundMessage);
          if (!result.success) {
            // Create validation error and route to error sink
            const validationError = new Error(
              `Validation failed for ${ctx.type}: ${JSON.stringify(result.error)}`,
            );
            (validationError as any).code = "VALIDATION_ERROR";
            (validationError as any).details = result.error;

            // Call custom hook if provided, otherwise route to error handler
            if (opts.onValidationError) {
              await opts.onValidationError(validationError, {
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
        }
      }

      // Continue with enriched context
      await next();
    });

    // Wrap the original createContext to attach send/reply/progress methods
    routerImpl.createContext = function (params: any) {
      const ctx = originalCreateContext(params);
      const routerImpl = this as CoreRouter<any>;

      // Helper to validate outgoing message (full root validation)
      const validateOutgoingPayload = async (
        schema: MessageDescriptor,
        payload: any,
      ): Promise<any> => {
        if (!opts.validateOutgoing) {
          return payload;
        }

        const schemaObj = schema as any;

        // If schema has safeParse, validate full root message
        if (typeof schemaObj?.safeParse === "function") {
          // Construct outbound message
          const outboundMessage = {
            type: schemaObj.__descriptor?.type || (schema as any).type,
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

            if (opts.onValidationError) {
              await opts.onValidationError(validationError, {
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

          if (opts.onValidationError) {
            await opts.onValidationError(validationError, {
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

      // Attach send() method for event handlers (always available after validation)
      (ctx as any).send = async (schema: MessageDescriptor, payload: any) => {
        // Validate outgoing payload
        const validatedPayload = await validateOutgoingPayload(schema, payload);
        // For now, this is a placeholder - will be implemented by adapters
        // In a real implementation, this would serialize and send to clients
        console.debug(`[send] ${schema.type}:`, validatedPayload);
      };

      // Attach reply() and progress() methods for RPC handlers
      (ctx as any).reply = async (payload: any) => {
        // Get the schema from registry to access response type
        const registry = routerImpl.getInternalRegistry();
        const entry = registry.get(ctx.type);

        if (entry) {
          const schema = entry.schema as any;
          // If this is an RPC schema with a response, validate against response schema
          if (
            schema?.response &&
            typeof schema.response?.safeParse === "function"
          ) {
            const responseMessage = {
              type: schema.responseType || schema.response.__descriptor?.type,
              meta: {},
              ...(payload !== undefined ? { payload } : {}),
            };

            const result = schema.response.safeParse(responseMessage);
            if (!result.success) {
              const validationError = new Error(
                `Reply validation failed for ${ctx.type}: ${JSON.stringify(result.error)}`,
              );
              (validationError as any).code = "REPLY_VALIDATION_ERROR";
              (validationError as any).details = result.error;

              if (opts.onValidationError) {
                await opts.onValidationError(validationError, {
                  type:
                    schema.responseType || schema.response.__descriptor?.type,
                  direction: "outbound",
                  payload,
                });
              } else {
                const lifecycle = routerImpl.getInternalLifecycle();
                await lifecycle.handleError(validationError, ctx);
              }
              throw validationError;
            }

            // TODO: Implement actual reply transmission via adapter
            console.debug(`[reply]:`, result.data.payload ?? payload);
          }
        }
      };

      (ctx as any).progress = async (payload: any) => {
        // Get the schema from registry to access response type
        const registry = routerImpl.getInternalRegistry();
        const entry = registry.get(ctx.type);

        if (entry) {
          const schema = entry.schema as any;
          // If this is an RPC schema with a response, validate against response schema
          if (
            schema?.response &&
            typeof schema.response?.safeParse === "function"
          ) {
            const responseMessage = {
              type: schema.responseType || schema.response.__descriptor?.type,
              meta: {},
              ...(payload !== undefined ? { payload } : {}),
            };

            const result = schema.response.safeParse(responseMessage);
            if (!result.success) {
              const validationError = new Error(
                `Progress validation failed for ${ctx.type}: ${JSON.stringify(result.error)}`,
              );
              (validationError as any).code = "PROGRESS_VALIDATION_ERROR";
              (validationError as any).details = result.error;

              if (opts.onValidationError) {
                await opts.onValidationError(validationError, {
                  type:
                    schema.responseType || schema.response.__descriptor?.type,
                  direction: "outbound",
                  payload,
                });
              } else {
                const lifecycle = routerImpl.getInternalLifecycle();
                await lifecycle.handleError(validationError, ctx);
              }
              throw validationError;
            }

            // TODO: Implement actual progress transmission via adapter
            console.debug(`[progress]:`, result.data.payload ?? payload);
          }
        }
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
