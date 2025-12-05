# Proposal: Composable Plugin Architecture

**Status:** Implemented (see ADR-031)
**Replaces:** Current monolithic `withZod()` design
**Rationale:** Eliminate ~880-LOC plugin that bundles unrelated concerns (validation, RPC, messaging, throttling, meta). Redesign as thin validator adapters + composable core plugins.

**Note:** This proposal has been implemented in ADR-031 (Plugin-Adapter Architecture). See `docs/adr/031-plugin-adapter-architecture.md` for the final design.

---

## Executive Summary

Current `withZod()` plugin violates separation of concerns:

- **880 lines** of mixed logic: validation, RPC semantics (reply guard, progress), send options, meta sanitization, throttling
- **Duplication**: Identical logic in Zod and Valibot instead of core
- **Hidden features**: Runtime behaviors (e.g., `validate` option) not visible in types
- **Hard to test**: Can't isolate validation from RPC from throttling
- **Tight coupling**: Can't use RPC without Zod; can't use Zod without RPC overhead

**Proposed refactor:**

1. **Thin validator packages** (`@ws-kit/zod`, `@ws-kit/valibot`) — ~200 LOC each
   - Schema builders (`message()`, `rpc()`)
   - Type helpers (`InferPayload`, `InferResponse`)
   - Single plugin: `withValidation()` — inbound validation only

2. **Composable core plugins** (`@ws-kit/core`, optionally sub-packages)
   - `withMessaging()` — unicast `.send()`, `router.publish()`, options (waitFor, meta, inheritCorrelationId, throttling)
   - `withRpc()` — `.reply()`, `.error()`, `.progress()`, one-shot guard, correlation tracking
   - Each ~100 LOC, one responsibility, testable in isolation

3. **Validator adapter pattern** (internal)
   - Core generic over validator type + adapter interface
   - Zod/Valibot provide `ValidatorAdapter` implementation
   - No changes to public API; users still do `import { createRouter, message, z } from "@ws-kit/zod"`

4. **Cleaner type system**
   - Plugin dependencies expressed as `TCaps` generics (e.g., RPC requires validation + messaging)
   - `rpc()` only accepts `RpcSchema` (no "never" tricks)
   - Branded schemas for type-safe inference without leaks

**Benefits:**

| Aspect                | Current                         | Proposed                                                        |
| --------------------- | ------------------------------- | --------------------------------------------------------------- |
| **Zod plugin**        | ~880 LOC (monolithic)           | ~200 LOC (validation only)                                      |
| **Duplication**       | Same logic in Zod/Valibot       | Zero—core owns shared logic                                     |
| **Testability**       | Mixed concerns                  | Each plugin testable standalone                                 |
| **Composability**     | All-or-nothing                  | Users pick features: validation-only, RPC with throttling, etc. |
| **Type safety**       | Hidden features (validate flag) | All runtime behaviors visible in types                          |
| **Optional features** | Validation forces RPC overhead  | Zero overhead for unused features                               |
| **Code size**         | 5 interdependent files          | 10 simpler, focused files                                       |

---

## Problem Statement

### Current Issues

**1. Monolithic Validator Plugin**

`packages/zod/src/plugin.ts` (~880 lines) bundles five distinct concerns:

- **Validation**: `safeParse` + error handling (lines ~80–140)
- **RPC Semantics**: One-shot reply guard, idempotency (lines ~200–250)
- **Messaging Options**: `SendOptions`, `ReplyOptions`, `ProgressOptions` (lines ~300–350)
- **Meta Management**: Sanitization, correlation ID preservation (lines ~360–400)
- **Progress Throttling**: `throttleMs` logic (lines ~410–450)

Each feature is independently useful but bundled by accident.

**Example**: User wants validation without RPC → still pays for reply guard, throttling, progress logic.

**2. Duplication Between Adapters**

Zod and Valibot implement nearly identical logic:

```typescript
// In both packages, independently:
function sanitizeMeta(userMeta: Record<string, unknown> | undefined) {
  if (!userMeta) return {};
  const sanitized = { ...userMeta };
  delete sanitized.type;
  delete sanitized.correlationId;
  return sanitized;
}

// Same for inheritCorrelationId, baseMeta, one-shot guards, throttling...
```

This is ~300 LOC of duplication across validators, making maintenance painful (bug fixes in one place, missing in the other).

**3. Generic Messaging Concerns in Validator Plugin**

These are orthogonal to validation:

- **`SendOptions` / `ReplyOptions` / `ProgressOptions`** — Defined in core but logic lives in Zod plugin
- **Meta sanitization** — Applied by Zod, but rule set should be core concern
- **Correlation ID preservation** — `inheritCorrelationId: true` implemented in plugin, not core
- **Progress throttling** — Request-response pattern detail, not validation detail

Makes it impossible to:

- Use RPC without a validator
- Change RPC behavior without touching validator plugins
- Implement alternative validators that match Zod/Valibot's RPC semantics

**4. Type-Level vs Runtime Mismatch**

The `validate` flag on `ReplyOptions` / `ProgressOptions` exists at runtime but is invisible in public types:

```typescript
// Handler calls this (runtime works)
ctx.reply(payload, { validate: false });

// But public RpcContext type doesn't expose it
// Only internal EnhancedContext knows about it
// → Hidden feature, hard to discover, untestable
```

**5. `rpc()` Type Signature Uses "Never" Trick**

```typescript
rpc<S extends AnySchema & { response?: AnySchema }>(
  schema: S,
  handler: (
    ctx: S extends { response: infer R }
      ? R extends AnySchema
        ? RpcContext<...>
        : never
      : never
  ) => void
): any;
```

Issues:

- Indirect error: If you pass a message schema (no `response`), type becomes `never` → unclear IDE message
- Only accepts `AnySchema` union at type level, not strictly `RpcSchema`
- No runtime assertion that schema is RPC-compatible

Better: Accept only `RpcSchema`, let TypeScript reject invalid schemas upfront with clear errors.

---

## Proposed Architecture

### Design Principles

1. **Single Responsibility** — Each plugin solves one problem; easy to test in isolation
2. **Composable** — Users chain plugins that actually matter for their use case
3. **Type Safe** — Plugin capabilities expressed via generics; methods available only if plugin applied
4. **No Duplication** — Shared logic (meta, correlation, throttling) lives in core once
5. **Zero Overhead** — Unused features add no runtime cost
6. **Simple** — Each plugin ~50–100 LOC, self-contained

### Architecture Overview

```
@ws-kit/core (validator-agnostic)
├── Router, HandlerContext, RpcContext
├── SendOptions, ReplyOptions, ProgressOptions
├── Shared utilities: sanitizeMeta(), inheritCorrelationId(), throttle()
├── Plugins: withMessaging(), withRpc()
└── Validator adapter interface (internal)

@ws-kit/zod, @ws-kit/valibot (thin adapters)
├── message(), rpc() schema builders
├── Type helpers: InferPayload, InferResponse, InferType, etc.
├── withValidation() plugin
└── Re-export: createRouter, z/v, types
```

### Core Plugin: withMessaging()

**Responsibility:** Fire-and-forget unicast and broadcast.

**Adds to context:**

- `ctx.send(schema, payload, opts?)` — Send to current connection (1-to-1)
- `router.publish(topic, schema, payload, opts?)` — Broadcast to subscribers (1-to-many)

**Signature:**

```typescript
// @ws-kit/plugins/src/messaging/types.ts

export interface SendOptions {
  signal?: AbortSignal; // Cancel before send
  waitFor?: "drain" | "ack"; // Backpressure control (async)
  meta?: Record<string, unknown>; // Custom metadata
  inheritCorrelationId?: boolean; // Auto-copy correlationId from request
}

export function withMessaging(): Plugin<
  any, // TContext
  { validation: true }, // Requires validation
  { messaging: true } // Provides messaging capability
> {
  return (router) => {
    // Middleware: Enrich context with send() and publish()
    router.use((ctx, next) => {
      ctx.send = async <S extends AnySchema>(
        schema: S,
        payload: InferPayload<S>,
        opts?: SendOptions,
      ): Promise<void | boolean> => {
        if (opts?.signal?.aborted) {
          return opts.waitFor ? false : undefined;
        }

        // Validate outgoing payload (uses validation plugin)
        const validated = await validateOutgoing(schema, payload);

        // Sanitize and enrich meta
        let outMeta: Record<string, unknown> = sanitizeMeta(opts?.meta);
        if (opts?.inheritCorrelationId && ctx.meta?.correlationId) {
          outMeta.correlationId = ctx.meta.correlationId;
        }

        // Construct message
        const message = {
          type: inferType(schema),
          meta: outMeta,
          ...(validated !== undefined ? { payload: validated } : {}),
        };

        // Send and optionally wait
        ctx.ws.send(JSON.stringify(message));
        if (opts?.waitFor === "drain") {
          return await ctx.ws.waitForDrain();
        }
        return undefined;
      };

      ctx.publish = async <S extends AnySchema>(
        topic: string,
        schema: S,
        payload: InferPayload<S>,
        opts?: SendOptions & { excludeSelf?: boolean },
      ): Promise<PublishResult> => {
        // Delegate to router-level pub/sub (if enabled)
        return router.publish(topic, schema, payload, opts);
      };

      return next();
    });

    return router as any; // Type narrowing
  };
}

// Core shared utilities (no duplication)
export function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!meta) return {};
  const clean = { ...meta };
  delete clean.type; // Reserved
  delete clean.correlationId; // Managed
  return clean;
}

export function inheritCorrelationId(
  outMeta: Record<string, unknown>,
  inMeta: Record<string, unknown> | undefined,
): void {
  if (inMeta?.correlationId) {
    outMeta.correlationId = inMeta.correlationId;
  }
}
```

**Key Points:**

- Requires validation plugin (type-checked: `{ validation: true }`)
- No RPC semantics here (no reply guard, no progress)
- Handles all messaging options: backpressure, meta, correlation
- ~100 LOC, testable standalone

---

### Core Plugin: withRpc()

**Responsibility:** Request-response pattern with terminal responses and streaming.

**Adds to context (RPC handlers only):**

- `ctx.reply(payload, opts?)` — Terminal success response (one-shot guarded)
- `ctx.error(code, message, details?, opts?)` — Terminal error response (one-shot guarded)
- `ctx.progress(update, opts?)` — Non-terminal streaming update

**Signature:**

```typescript
// @ws-kit/plugins/src/rpc/types.ts

export interface ReplyOptions extends SendOptions {
  // Inherits: signal, waitFor, meta
}

export interface ProgressOptions extends SendOptions {
  throttleMs?: number; // Rate-limit rapid updates
}

export function withRpc(options?: { progressThrottleMs?: number }): Plugin<
  any, // TContext
  { validation: true; messaging: true }, // Requires both
  { rpc: true } // Provides RPC capability
> {
  return (router) => {
    router.use((ctx, next) => {
      // Per-RPC state
      let replied = false;
      let lastProgressTime = 0;

      // Terminal response (one-shot guarded)
      ctx.reply = async <T>(
        payload: T,
        opts?: ReplyOptions,
      ): Promise<void | undefined> => {
        if (replied) {
          // Already replied; no-op (logged in dev mode)
          return opts?.waitFor ? Promise.resolve() : undefined;
        }
        replied = true;

        // Use messaging's send() to actual response
        const responseSchema = ctx.schema.response;
        return ctx.send(responseSchema, payload, opts);
      };

      // Terminal error response (shared one-shot guard)
      ctx.error = async <T = unknown>(
        code: string,
        message: string,
        details?: T,
        opts?: ReplyOptions,
      ): Promise<void | undefined> => {
        if (replied) {
          return opts?.waitFor ? Promise.resolve() : undefined;
        }
        replied = true;

        // Construct error payload
        const errorPayload = {
          code,
          message,
          ...(details !== undefined ? { details } : {}),
        };

        // Send as special RPC_ERROR message (preserved correlation)
        return ctx.send(
          { type: "$ws:rpc-error" }, // Reserved control type
          errorPayload,
          { ...opts, inheritCorrelationId: true },
        );
      };

      // Non-terminal progress update (can call multiple times)
      ctx.progress = async <T>(
        update: T,
        opts?: ProgressOptions,
      ): Promise<void | undefined> => {
        if (replied) {
          // After terminal response; no-op
          return undefined;
        }

        // Throttle if configured
        const throttleMs = opts?.throttleMs ?? options?.progressThrottleMs ?? 0;
        if (throttleMs > 0) {
          const now = Date.now();
          if (now - lastProgressTime < throttleMs) {
            return undefined; // Silently drop
          }
          lastProgressTime = now;
        }

        // Send as progress message (using messaging)
        return ctx.send({ type: "$ws:rpc-progress" }, update, {
          ...opts,
          inheritCorrelationId: true,
        });
      };

      return next();
    });

    // Add router.rpc() method (conditional on RPC capability)
    (router as any).rpc = function <S extends RpcSchema>(
      schema: S,
      handler: (
        ctx: RpcContext<any, InferPayload<S>, InferResponse<S>>,
      ) => void | Promise<void>,
    ) {
      return this.on(schema as any, handler);
    };

    return router as any; // Type narrowing
  };
}
```

**Key Points:**

- Requires both validation and messaging
- One-shot guard shared between `.reply()` and `.error()`
- Progress throttling built-in, optional
- Progress and errors use reserved `$ws:rpc-*` types
- ~120 LOC, testable standalone
- No outbound validation logic (delegated to messaging)

---

### Validator Plugin: withValidation()

**Responsibility:** Only inbound and optional outgoing validation.

**Signature:**

```typescript
// @ws-kit/zod/src/validation.ts

export interface WithValidationOptions {
  validateOutgoing?: boolean; // Default: true
  onValidationError?: (
    error: ZodError,
    context: {
      type: string;
      direction: "inbound" | "outbound";
      payload: unknown;
    },
  ) => void | Promise<void>;
}

export function withValidation(options: WithValidationOptions = {}): Plugin<
  any, // TContext
  {}, // No requirements
  { validation: true } // Provides validation capability
> {
  const pluginOptions = {
    validateOutgoing: options.validateOutgoing ?? true,
    onValidationError: options.onValidationError,
  };

  return (router) => {
    // Inbound validation middleware
    router.use(async (ctx, next) => {
      const schema = ctx.schema; // From router
      const payloadSchema = getPayloadSchema(schema); // Extract Zod schema

      if (payloadSchema) {
        const result = payloadSchema.safeParse(ctx.payload);

        if (!result.success) {
          // Validation failed
          if (pluginOptions.onValidationError) {
            await pluginOptions.onValidationError(result.error, {
              type: ctx.type,
              direction: "inbound",
              payload: ctx.payload,
            });
          } else {
            // Use core error (if in RPC context)
            await ctx.error?.("INVALID_ARGUMENT", formatZodError(result.error));
          }
          return; // Don't call next()
        }

        // Overwrite ctx.payload with validated data
        (ctx as any).payload = result.data;
      }

      // Store validator for use by messaging's outgoing validation
      (ctx as any).__validator = { schema, payloadSchema };
      await next();
    });

    // Hook outgoing validation (used by messaging plugin)
    // This is done via a core extensibility point (e.g., router.onBeforeSend)
    if (pluginOptions.validateOutgoing) {
      router.use((ctx, next) => {
        // Store validator instance on context for messaging to call
        ctx.__validateOutgoing = async (
          schema: AnySchema,
          payload: unknown,
        ) => {
          const payloadSchema = getPayloadSchema(schema);
          if (!payloadSchema) return payload; // No validation needed

          const result = payloadSchema.safeParse(payload);
          if (!result.success) {
            // Validation error on outgoing
            if (pluginOptions.onValidationError) {
              await pluginOptions.onValidationError(result.error, {
                type: inferType(schema),
                direction: "outgoing",
                payload,
              });
            }
            throw new Error(
              `Outgoing validation failed: ${formatZodError(result.error)}`,
            );
          }
          return result.data;
        };
        return next();
      });
    }

    return router as any;
  };
}
```

**Key Points:**

- **Only** inbound and outgoing validation; nothing else
- No RPC semantics, no meta management, no options
- ~120 LOC in Zod; identical in Valibot
- Type helpers exported separately (no runtime deps)

---

### User-Facing API

**Before (current):**

```typescript
import { z, message, rpc, createRouter } from "@ws-kit/zod";

const router = createRouter<ConnectionData>();
// Automatically applies: withValidation(), withMessaging(), withRpc()
// (monolithic, no choice)
```

**After (proposed, composable):**

```typescript
import { createRouter, withZod } from "@ws-kit/zod";
import { withMessaging, withRpc } from "@ws-kit/plugins";

const router = createRouter<ConnectionData>()
  .plugin(withZod())
  .plugin(withMessaging())
  .plugin(withRpc());

// Now all methods available, with full type safety
router.on(PingMsg, (ctx) => {
  ctx.send(PongMsg, { reply: ctx.payload.text }); // Typed
  ctx.publish('events', EventMsg, { ... }); // Typed
});

router.rpc(GetUserMsg, async (ctx) => {
  ctx.progress({ status: 'loading' });
  const user = await db.get(ctx.payload.id);
  if (!user) {
    return ctx.error('NOT_FOUND', 'User not found');
  }
  ctx.reply({ id: user.id, name: user.name });
});
```

**Variant: Validation-Only (Zero RPC Overhead):**

```typescript
const router = createRouter<ConnectionData>().plugin(withValidation());
// No messaging, no RPC
// ctx.send, ctx.reply, ctx.progress → not available

router.on(EventMsg, (ctx) => {
  // ctx.payload is validated
  // But no messaging methods → use raw ws.send() if needed
});
```

**Variant: RPC with Custom Validation:**

```typescript
const router = createRouter<ConnectionData>()
  .plugin(myCustomValidator()) // Non-Zod validator
  .plugin(withMessaging())
  .plugin(withRpc());
```

---

## Benefits

| Aspect             | Current                               | Proposed                                            |
| ------------------ | ------------------------------------- | --------------------------------------------------- |
| **Code Size**      | `withZod()` ~880 LOC                  | `withValidation()` ~120 LOC + core plugins ~220 LOC |
| **Duplication**    | Same logic in Zod/Valibot (~300 LOC)  | Zero—core owns once                                 |
| **Type Safety**    | Hidden features (validate flag)       | All behaviors visible in types                      |
| **Testability**    | Mixed concerns, hard to isolate       | Each plugin testable standalone                     |
| **Composability**  | All-or-nothing                        | Users pick needed features                          |
| **Overhead**       | Validation forces RPC code            | Zero for unused features                            |
| **Maintenance**    | Bug fixes in 2 places (Zod + Valibot) | One place (core)                                    |
| **Type Inference** | Works but uses "never" tricks         | Clean, uses branded types                           |
| **Readability**    | 5-file plugin hard to follow          | 3-4 focused, ~100-LOC files each                    |

---

## Implementation Strategy

### Phase 1: Create Core Plugins (Minimal Breaking)

1. Add `@ws-kit/plugins/messaging.ts` with `withMessaging()`
2. Add `@ws-kit/plugins/rpc.ts` with `withRpc()`
3. Extract shared utilities to `@ws-kit/core/utils/` (sanitizeMeta, inheritCorrelationId, throttle, etc.)
4. Update `Router<TContext, TCaps>` type to support plugin chaining
5. Update `HandlerContext` / `RpcContext` types to reflect capabilities

**Migration**: Provide `withZodFull()` as convenience that composes `withValidation() + withMessaging() + withRpc()` for backward compatibility.

### Phase 2: Slim Validator Plugins

1. Replace `@ws-kit/zod/plugin.ts` with `@ws-kit/zod/validation.ts` (~120 LOC)
2. Extract type helpers to separate file (no runtime deps)
3. Re-export core plugins from `@ws-kit/zod/index.ts`
4. Same for `@ws-kit/valibot`

### Phase 3: Testing

- `packages/plugins/test/messaging/` — send/publish options, correlation, sanitization
- `packages/plugins/test/rpc/` — reply guard, error response, progress throttling
- `packages/zod/test/` — inbound/outgoing validation, error handling
- Type inference tests in `packages/*/test/types/`

### Phase 4: Documentation

- Update `docs/specs/context-methods.md` to reference individual plugins
- Add `docs/specs/plugins.md` explaining plugin dependencies and composability
- Update `docs/getting-started.md` with new plugin pattern
- ADR-028 (or new ADR) documenting plugin architecture

---

## Type System

### Plugin Capability Markers

```typescript
// @ws-kit/core/src/types.ts

// Capability markers (discriminated union)
export interface WithValidation {
  validation: true;
}

export interface WithMessaging {
  messaging: true;
}

export interface WithRpc {
  rpc: true;
}

export type Capabilities = Partial<WithValidation & WithMessaging & WithRpc>;

// Router generic over capabilities
export interface Router<TContext extends ConnectionData, TCaps extends Capabilities = {}> {
  on<S extends MessageSchema>(schema: S, handler: Handler<TContext, TCaps, S>): this;

  // Conditional methods gated by capabilities
  ...(TCaps extends WithMessaging
    ? {
        publish<S extends MessageSchema>(
          topic: string,
          schema: S,
          payload: InferPayload<S>,
          opts?: SendOptions,
        ): Promise<PublishResult>;
      }
    : {});

  ...(TCaps extends WithRpc
    ? {
        rpc<S extends RpcSchema>(
          schema: S,
          handler: Handler<TContext, TCaps, S>,
        ): this;
      }
    : {});
}

// Handler context shaped by capabilities
export type HandlerContext<TContext, TCaps, S> = BaseContext<TContext, S> &
  (TCaps extends WithMessaging
    ? {
        // Overloaded: void without waitFor, Promise<boolean> with waitFor
        send<T extends MessageSchema>(
          schema: T,
          payload: InferPayload<T>,
          opts?: SendOptionsSync,
        ): void;
        send<T extends MessageSchema>(
          schema: T,
          payload: InferPayload<T>,
          opts: SendOptionsAsync,
        ): Promise<boolean>;
      }
    : {}) &
  (TCaps extends WithRpc
    ? {
        reply<T = unknown>(
          payload: T,
          opts?: ReplyOptions,
        ): void | Promise<void>;

        error(
          code: string,
          message: string,
          details?: unknown,
          opts?: ReplyOptions,
        ): void | Promise<void>;

        progress<T = unknown>(
          update: T,
          opts?: ProgressOptions,
        ): void | Promise<void>;
      }
    : {});
```

**Benefits:**

- TypeScript narrows method availability based on plugins applied
- `router.rpc()` unavailable until both validation + messaging + rpc plugins applied
- IDE autocomplete only shows available methods
- Compile-time error if using `.reply()` without `withRpc()`

---

## Migration Path

### For Existing Code

**Option 1: Gradual (via `withZodFull()` compatibility layer)**

```typescript
// Current code works unchanged
import { createRouter } from "@ws-kit/zod";

const router = createRouter<ConnectionData>();
// Automatically uses withZodFull() = withValidation() + withMessaging() + withRpc()
```

**Option 2: Explicit (recommended for new code)**

```typescript
import { createRouter } from "@ws-kit/zod";
import { withValidation, withMessaging, withRpc } from "@ws-kit/zod";

const router = createRouter<ConnectionData>()
  .plugin(withValidation())
  .plugin(withMessaging())
  .plugin(withRpc());
```

### Deprecation

- Deprecate `createRouter()` default behavior (log warning if no plugins applied)
- Announce 1-2 version window for migration
- Eventually remove `withZodFull()` in major version bump

---

## Risks and Mitigations

### Risk 1: Plugin Ordering Confusion

**Mitigation**: Type system enforces ordering (RPC requires messaging + validation). Error messages clear. Docs emphasize convention: validation → messaging → RPC.

### Risk 2: Type Inference Regression

**Mitigation**: Use branded schemas (current approach) for inference. Extensive type tests. No changes to `InferPayload`, `InferType` helpers.

### Risk 3: Validator Adapter Complexity

**Mitigation**: Keep adapter interface minimal. Zod/Valibot implementations nearly identical (easy to maintain). Core owns all logic; validators just extract schemas.

### Risk 4: Plugin Composition Overhead

**Mitigation**: Each plugin is tiny (~100 LOC), zero runtime cost if feature unused. No perf regression.

---

## Comparison: Current vs Proposed

### File Structure

**Current:**

```
packages/zod/src/
├── plugin.ts          (880 LOC monolith)
├── runtime.ts         (helpers)
├── types.ts           (inference)
└── index.ts           (exports)

packages/valibot/src/
├── plugin.ts          (880 LOC, duplicate of Zod)
├── runtime.ts
├── types.ts
└── index.ts
```

**Implemented:**

```
packages/plugins/src/
├── messaging/
│   ├── index.ts       (~100 LOC, withMessaging())
│   └── types.ts       (SendOptions, etc.)
├── rpc/
│   ├── index.ts       (~120 LOC, withRpc())
│   └── types.ts       (ReplyOptions, ProgressOptions, etc.)
└── index.ts           (exports)

packages/zod/src/
├── plugin.ts          (~150 LOC, withZod validator plugin + helpers)
├── runtime.ts         (Zod-specific validation logic)
├── internal.ts        (shared utilities)
├── types.ts           (InferPayload, InferMessage, etc.)
└── index.ts           (re-exports: z, message, rpc, createRouter, withZod, plugin helpers)

packages/valibot/src/
├── plugin.ts          (~150 LOC, withValibot validator plugin + helpers)
├── runtime.ts         (Valibot-specific validation logic)
├── internal.ts        (shared utilities)
├── types.ts           (InferPayload, InferMessage, etc.)
└── index.ts           (re-exports: v, message, rpc, createRouter, withValibot, plugin helpers)
```

### Code Examples

**Inbound Validation:**

**Current** (in Zod plugin ~60 LOC):

```typescript
const payloadSchema = getZodPayload(schema);
const result = payloadSchema.safeParse(inboundMessage);
if (!result.success) {
  const err = new Error(...) as any;
  err.code = "VALIDATION_ERROR";
  err.details = result.error;
  if (pluginOpts.onValidationError) {
    await pluginOpts.onValidationError(err, { ... });
  } else {
    await lifecycle.handleError(err, ctx);
  }
  return;
}
if (result.data.payload !== undefined) {
  enhCtx.payload = result.data.payload;
}
```

**Implemented** (in plugin.ts and runtime.ts):

The validation logic is distributed across the validator plugin packages:

- `plugin.ts` (~150 LOC): Sets up the validation middleware, error handling, and plugin API
- `runtime.ts` (~80 LOC): Contains the actual Zod/Valibot-specific parsing logic

Core pattern (simplified):

```typescript
// In runtime.ts: extract and validate payload schema
const payloadSchema = getPayloadSchema(schema);
const result = payloadSchema.safeParse(ctx.payload);
if (!result.success) {
  if (options.onValidationError) {
    await options.onValidationError(result.error, {
      type: ctx.type,
      direction: "inbound",
      payload: ctx.payload,
    });
  } else {
    await ctx.error?.("INVALID_ARGUMENT", formatZodError(result.error));
  }
  return;
}
ctx.payload = result.data;
await next();
```

Cleaner: errors routed via core error handling, no ceremony. See `packages/zod/src/runtime.ts` and `packages/valibot/src/runtime.ts` for actual implementations.

### One-Shot Reply Guard

**Current** (in Zod plugin ~20 LOC):

```typescript
let replied = false;
enhCtx.reply = (payload: any, opts?: ReplyOptions): void | Promise<void> => {
  guardRpc();
  if (replied) {
    return opts?.waitFor ? Promise.resolve() : undefined;
  }
  replied = true;
  // ... send message
};
enhCtx.error = (...) => {
  guardRpc();
  if (replied) {
    return opts?.waitFor ? Promise.resolve() : undefined;
  }
  replied = true;
  // ... send error
};
```

**Proposed** (in rpc.ts ~20 LOC):

```typescript
let replied = false;
ctx.reply = async (payload, opts?) => {
  if (replied) return opts?.waitFor ? Promise.resolve() : undefined;
  replied = true;
  return ctx.send(ctx.schema.response, payload, opts);
};
ctx.error = async (code, message, details, opts?) => {
  if (replied) return opts?.waitFor ? Promise.resolve() : undefined;
  replied = true;
  return ctx.send({ type: "$ws:rpc-error" }, { code, message, details }, opts);
};
```

Cleaner: delegates to messaging plugin for actual send, no duplication.

---

## Plugin-Adapter Architecture

Beyond the validator plugins, stateful features like **pub/sub** and **rate-limiting** require a different approach: they need backend implementations (adapters) that are swappable without code changes.

### Design: Plugins in Core, Adapters Separate

**Plugins** = Framework features (live in `@ws-kit/core`):

- `withPubSub()` — Pub/sub pattern (any backend)
- `withRateLimit()` — Rate limiting (any backend)

**Adapters** = Backend implementations:

- Memory adapters in `@ws-kit/memory` (zero-config dev defaults)
- External adapters in separate packages:
  - `@ws-kit/redis` — Redis pub/sub and rate-limiting
  - `@ws-kit/cloudflare` — Cloudflare Durable Objects + native rate-limiting
  - Custom adapters in user code

### Package Structure

```
@ws-kit/core/src
├── plugins/                    # Framework features
│   ├── messaging/
│   │   ├── index.ts           # withMessaging() plugin
│   │   └── types.ts           # SendOptions, etc.
│   ├── rpc/
│   │   ├── index.ts           # withRpc() plugin
│   │   └── types.ts           # ReplyOptions, ProgressOptions
│   ├── pubsub/
│   │   ├── index.ts           # withPubSub() plugin
│   │   └── types.ts           # PubSubAdapter interface
│   ├── rate-limit/
│   │   ├── index.ts           # withRateLimit() plugin
│   │   └── types.ts           # RateLimiterAdapter interface
│   └── validation/
│       ├── index.ts           # withValidation() plugin
│       └── types.ts           # ValidatorAdapter interface
├── adapters/                   # Default implementations (zero-config)
│   ├── pubsub/
│   │   └── memory.ts          # memoryPubSub()
│   └── rate-limit/
│       └── memory.ts          # memoryRateLimiter()
└── index.ts                   # Re-exports plugins + memory adapters

@ws-kit/zod & @ws-kit/valibot
└── index.ts                   # Re-exports core plugins (convenience)

@ws-kit/redis
├── pubsub.ts                  # redisPubSub()
├── rate-limit.ts              # redisRateLimiter()
└── index.ts

@ws-kit/cloudflare
├── pubsub.ts                  # cloudflarePubSub()
├── rate-limit.ts              # cloudflareRateLimiter()
└── index.ts
```

### Usage Pattern: Zero-Config Dev, Swappable Prod

**Development (in-memory, no setup):**

```typescript
const router = createRouter()
  .plugin(withZod())
  .plugin(withPubSub()) // Uses memoryPubSub() by default
  .plugin(
    withRateLimit({
      capacity: 100,
      tokensPerSecond: 10,
    }),
  );
```

**Production (Redis, one-line change):**

```typescript
import { redisPubSub, redisRateLimiter } from "@ws-kit/redis";

const router = createRouter()
  .plugin(withZod())
  .plugin(
    withPubSub({
      adapter: redisPubSub(redis), // ← Swap adapter
    }),
  )
  .plugin(
    withRateLimit({
      limiter: redisRateLimiter(redis), // ← Swap adapter
      capacity: 1000,
      tokensPerSecond: 50,
    }),
  );
```

**Cloudflare Workers:**

```typescript
import { cloudflarePubSub, cloudflareRateLimiter } from "@ws-kit/cloudflare";

export default {
  fetch(req: Request, env: Env) {
    const router = createRouter()
      .plugin(withZod())
      .plugin(withPubSub({ adapter: cloudflarePubSub(env.DURABLE_OBJECTS) }))
      .plugin(
        withRateLimit({ limiter: cloudflareRateLimiter(env.RATE_LIMIT) }),
      );
    return router.handle(req);
  },
};
```

**No code changes between dev, staging, and production—only adapter config.**

### Adapter Interfaces

**PubSubAdapter** (from `@ws-kit/core`):

```typescript
export interface PubSubAdapter {
  subscribe(clientId: string, topic: string): Promise<void>;
  unsubscribe(clientId: string, topic: string): Promise<void>;
  publish(topic: string, message: SerializedMessage): Promise<PublishResult>;
  list(clientId: string): Promise<string[]>;
}
```

**RateLimiterAdapter** (from `@ws-kit/rate-limit`):

```typescript
export interface RateLimiterAdapter {
  consume(
    key: string,
    tokens: number,
  ): Promise<{
    ok: boolean;
    retryAfterMs?: number;
  }>;
  reset(key: string): Promise<void>;
}
```

### Benefits

- ✅ **Zero-config development**: Works immediately, no Redis/infrastructure needed
- ✅ **Testing**: Apps pass tests without external services
- ✅ **Scaling**: Same code runs on single server (memory) → distributed (Redis) → serverless (Cloudflare)
- ✅ **Clear ownership**: Core owns plugins, each adapter package owns its backend
- ✅ **Tree-shakeable**: Unused adapters not bundled
- ✅ **Extensible**: Users implement custom adapters for proprietary backends

For complete architecture rationale and implementation details, see [ADR-031: Plugin-Adapter Architecture](../adr/031-plugin-adapter-architecture.md).

---

## Conclusion

This refactored architecture achieves **separation of concerns**, **eliminates duplication**, and improves **testability** while maintaining **full TypeScript type safety** and **simple DX**. Users compose only the plugins they need; validators stay thin and focused; core owns all shared logic.

The result is a more maintainable, composable system that aligns with WS-Kit's design principle: **"expose the smallest possible public API"** and **"keep it simple and pragmatic."**

### Next Steps

1. Gather feedback on plugin decomposition and type system
2. Prototype Phase 1 (core plugins)
3. Refactor validators as Phase 2
4. Implement pub/sub and rate-limiting adapters
5. Extensive type and runtime testing
6. Document migration path and new plugin patterns
