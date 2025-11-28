// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * withZod() plugin: adds Zod validation capability to the router.
 *
 * Composes core plugins (withMessaging + withRpc) with Zod-specific validation:
 * - Validates inbound payloads against Zod schemas
 * - Optionally validates outbound payloads (send, reply, progress)
 * - Adds ctx.payload (validated) to event handlers
 * - Provides .rpc() method for request-response handlers
 *
 * Once plugged, the router gains:
 * - ctx.send() - Fire-and-forget unicast (from withMessaging)
 * - ctx.reply() / ctx.error() / ctx.progress() - RPC methods (from withRpc)
 * - ctx.payload - Validated message payload
 * - router.rpc() - Request-response handler registration
 *
 * Validation errors are routed to router.onError() or custom onValidationError hook.
 */

import type {
  ConnectionData,
  ProgressOptions as CoreProgressOptions,
  PublishOptions as CorePublishOptions,
  ReplyOptions as CoreReplyOptions,
  MessageDescriptor,
  MinimalContext,
  SendOptions,
} from "@ws-kit/core";
import { getRouteIndex } from "@ws-kit/core";
import {
  getKind,
  getRouterPluginAPI,
  getSchemaOpts,
  typeOf,
  type SchemaOpts,
} from "@ws-kit/core/internal";
import { definePlugin } from "@ws-kit/core/plugin";
import {
  withMessaging as coreWithMessaging,
  withRpc as coreWithRpc,
} from "@ws-kit/plugins";
import { getZodPayload, validatePayload } from "./internal.js";
import type { AnySchema } from "./types.js";

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
  publish?: (
    topic: string,
    schema: AnySchema | MessageDescriptor,
    payload: unknown,
    opts?: CorePublishOptions,
  ) => Promise<any>;
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
 * The runtime API surface this plugin adds:
 * - Capability marker for type narrowing ({ validation: true })
 * - rpc() for registering RPC handlers (does NOT overwrite router.on)
 *
 * Note: Type-level on()/rpc() overloads are supplied by Router’s ValidationAPI
 * when the { validation: true } capability is present. We only add the runtime
 * rpc() implementation; router.on remains untouched to avoid collisions.
 */
interface WithZodCapability<TContext extends ConnectionData = ConnectionData> {
  readonly validation: true;
  readonly __caps: { validation: true };
}

export function withZod<TContext extends ConnectionData = ConnectionData>(
  options?: WithZodOptions,
) {
  const pluginOpts = {
    validateOutgoing: options?.validateOutgoing ?? true,
    onValidationError: options?.onValidationError,
  };

  return definePlugin<TContext, WithZodCapability<TContext>>((router) => {
    // Step 1: Apply core messaging and RPC plugins first
    // These provide ctx.send(), ctx.reply(), ctx.error(), ctx.progress()
    router.plugin(coreWithMessaging<TContext>());
    router.plugin(coreWithRpc<TContext>());

    // Step 2: Get plugin API for registering validation middleware
    const api = getRouterPluginAPI(router);

    // Step 3: Inject validation middleware that validates root message and enriches context
    // This runs BEFORE core messaging/RPC enhancers (lower priority)
    // so that ctx.payload is available for the messaging methods to use
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

          // Stash schema info for later use in reply/progress/send validation
          const kind = getKind(schemaInfo.schema); // read from DESCRIPTOR symbol
          const existingWskit = enhCtx.__wskit || {};
          Object.defineProperty(enhCtx, "__wskit", {
            enumerable: false,
            configurable: true,
            value: {
              ...existingWskit,
              ...(kind !== undefined && { kind }),
              request: schema,
              response: schema.response,
            } satisfies WsContext,
          });
        }
      }

      // Continue with enriched context
      await next();
    });

    // Step 4: Register context enhancer to add outbound validation capability
    // This wraps the core messaging/RPC methods to optionally validate outgoing payloads
    api.addContextEnhancer(
      (ctx: MinimalContext<any>) => {
        const enhCtx = ctx as EnhancedContext;
        // Capture lifecycle for use in nested functions
        const lifecycle = api.getLifecycle();

        // Helper: validate outgoing message (full root validation)
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

        // Get the messaging extension from core plugin
        const messagingExt = ctx.extensions.get("messaging") as any;
        const rpcExt = ctx.extensions.get("rpc") as any;
        const pubsubExt = ctx.extensions.get("pubsub") as any;

        if (messagingExt?.send) {
          // Wrap send() with outbound validation
          const coreSend = messagingExt.send;
          (enhCtx as any).send = async (
            schema: AnySchema | MessageDescriptor,
            payload: any,
            opts?: SendOptions,
          ): Promise<any> => {
            // Validate outgoing payload if enabled
            const validatedPayload = await validateOutgoingPayload(
              schema,
              payload,
            );
            // Delegate to core send with validated payload
            return coreSend(schema, validatedPayload, opts);
          };
        }

        if (rpcExt?.reply) {
          // Wrap reply() with outbound validation
          const coreReply = rpcExt.reply;
          (enhCtx as any).reply = async (
            payload: any,
            opts?: ReplyOptions,
          ): Promise<any> => {
            const wskit = enhCtx.__wskit;
            if (wskit?.response) {
              const schemaOpts = getSchemaOpts(wskit.response);
              const eff = resolveOptions(schemaOpts, pluginOpts);
              const shouldValidate = opts?.validate ?? eff.validateOutgoing;

              if (shouldValidate) {
                // Validate response payload
                const validatedPayload = await validateOutgoingPayload(
                  wskit.response,
                  payload,
                );
                return coreReply(validatedPayload, opts);
              }
            }
            return coreReply(payload, opts);
          };
        }

        if (rpcExt?.progress) {
          // Wrap progress() with outbound validation
          const coreProgress = rpcExt.progress;
          (enhCtx as any).progress = async (
            payload: any,
            opts?: ProgressOptions,
          ): Promise<any> => {
            const wskit = enhCtx.__wskit;
            if (wskit?.response) {
              const schemaOpts = getSchemaOpts(wskit.response);
              const eff = resolveOptions(schemaOpts, pluginOpts);
              const shouldValidate = opts?.validate ?? eff.validateOutgoing;

              if (shouldValidate) {
                // Validate progress payload
                const validatedPayload = await validateProgressPayload(
                  wskit.response,
                  payload,
                );
                return coreProgress(validatedPayload, opts);
              }
            }
            return coreProgress(payload, opts);
          };
        }

        const corePublish = pubsubExt?.publish ?? (enhCtx as any).publish;
        if (corePublish) {
          // Wrap publish() with outbound validation
          (enhCtx as any).publish = async (
            topic: string,
            schema: AnySchema | MessageDescriptor,
            payload: any,
            opts?: CorePublishOptions,
          ): Promise<any> => {
            const validatedPayload = await validateOutgoingPayload(
              schema,
              payload,
            );
            return corePublish(topic, schema, validatedPayload, opts);
          };
        }
      },
      { priority: 100 }, // Higher priority (after core plugins)
    );

    // Return the plugin API extensions with capability marker and rpc().
    return {
      validation: true as const,
      __caps: { validation: true as const },
    } satisfies WithZodCapability<TContext>;
  });
}
