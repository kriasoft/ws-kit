# Validation Architecture

**Status**: ✅ Implemented

## Validation vs Application Errors

**This spec covers validation errors** (router rejects malformed messages before handlers run).

For **application errors** (handlers send error messages to clients), see docs/specs/error-handling.md.

| Error Type              | Where Caught         | Handler Invoked? | Spec                         |
| ----------------------- | -------------------- | ---------------- | ---------------------------- |
| Parse failures          | Router (pre-handler) | ❌ Never         | docs/specs/validation.md     |
| Schema validation       | Router (pre-handler) | ❌ Never         | docs/specs/validation.md     |
| Business logic failures | Handler (app code)   | ✅ Always        | docs/specs/error-handling.md |

**Key distinction**: Validation errors are **transport-layer** concerns (malformed wire format); application errors are **business-layer** concerns (invalid state, unauthorized access, resource not found).

## Flow {#Flow}

```text
Message → JSON Parse → Type Check → Handler Lookup → Normalize → Middleware → Schema Validation → Handler
```

**Pipeline stages**:

1. **Parse**: JSON.parse() the raw WebSocket message
2. **Type check**: Ensure `type` field exists and is a string
3. **Handler lookup**: Find registered handler for message type
4. **Normalize**: Ensure `meta` exists, strip reserved keys (security boundary)
5. **Middleware**: Execute global and per-route middleware (can skip handler)
6. **Validate**: Schema validation on normalized message (strict mode - see below)
7. **Handler**: Invoke handler with validated message + server context

Adapters MUST receive normalized messages for validation.

**Strict mode validation**: Schemas MUST reject unknown keys, including unexpected `payload` when schema defines none. See docs/specs/schema.md#Strict-Schemas for rationale and #Strict-Mode-Enforcement below for adapter requirements.

## Type Inference for Handlers {#Type-Inference}

### Event Handlers (`.on()`)

Event handlers registered with `.on()` receive typed context **only after a validation plugin is applied**. Without a plugin, `ctx.payload` is `unknown`.

**Without validation plugin:**

```typescript
router.on(MyMsg, (ctx) => {
  ctx.payload; // ❌ Type is 'unknown'—no validation applied
});
```

**With validation plugin:**

```typescript
router
  .plugin(withZod()) // or withValibot()
  .on(MyMsg, (ctx) => {
    ctx.payload; // ✅ Type inferred from schema
  });
```

**Rationale**: Validation is **opt-in via plugins**. Events without validation should not imply type safety. This design ensures:

- Core remains validator-agnostic
- Type inference is explicit and composable
- Handlers clearly signal when they rely on validation

### RPC Handlers (`.rpc()`)

RPC handlers require a validation plugin and **automatically infer both request and response types** from the schema:

```typescript
const GetUser = rpc(
  "GET_USER",
  { id: z.string() }, // Request shape
  "USER",
  { id: z.string(), name: z.string() }, // Response shape
);

router.plugin(withZod()).rpc(GetUser, (ctx) => {
  // ctx.payload: { id: string } ✅ Inferred
  // ctx.reply: (payload: { id: string; name: string }) => Promise<void> ✅ Inferred
});
```

### Custom Connection Data

Both handlers infer context from custom `ConnectionData`:

```typescript
declare module "@ws-kit/core" {
  interface ConnectionData {
    userId?: string;
  }
}

router.on(MyMsg, (ctx) => {
  ctx.data.userId; // ✅ Properly typed
});

router.rpc(GetUser, (ctx) => {
  ctx.data.userId; // ✅ Properly typed
});
```

## Strict Mode Enforcement

Adapters MUST configure validators to reject unknown keys at all levels (root, meta, payload).

**Adapter Requirements:**

| Validator | Root Object                | Nested Objects                            |
| --------- | -------------------------- | ----------------------------------------- |
| Zod       | `.strict()` on root object | Recursively applies to nested objects     |
| Valibot   | `strictObject()`           | Use `strictObject()` for meta and payload |

**Validation Behavior:**

| Schema Definition   | Wire Message                                      | Result                            |
| ------------------- | ------------------------------------------------- | --------------------------------- |
| No `payload` field  | Includes `payload` key (even `undefined` or `{}`) | ❌ MUST fail validation           |
| No `payload` field  | Omits `payload` key                               | ✅ MUST pass (if otherwise valid) |
| Has `payload` field | Omits `payload` key                               | ❌ MUST fail validation           |
| Has `payload` field | Includes `payload` with valid data                | ✅ MUST pass (if otherwise valid) |
| Any schema          | Unknown keys at root/meta/payload                 | ❌ MUST fail validation           |

**Implementation (using export-with-helpers pattern from ADR-007):**

```typescript
// Zod adapter (@ws-kit/zod/src/index.ts)
export function message<
  const Type extends string,
  const Shape extends z.ZodRawShape | undefined = undefined,
>(
  type: Type,
  payload?: Shape extends z.ZodRawShape ? Shape : undefined,
  meta?: z.ZodRawShape,
): ZodSchema<Type, Payload, Meta> {
  const baseShape = {
    type: z.literal(type),
    meta: z.object({ ...defaultMeta, ...meta }).strict(),
  };

  const schema = payload
    ? z.object({ ...baseShape, payload: z.object(payload).strict() })
    : z.object(baseShape);

  return schema.strict(); // CRITICAL: Rejects unknown keys including unexpected 'payload'
}

// Valibot adapter (@ws-kit/valibot/src/index.ts)
export function message<
  const Type extends string,
  const Shape extends Record<string, any> | undefined = undefined,
>(
  type: Type,
  payload?: Shape,
  meta?: Record<string, any>,
): ValibotSchema<Type, Payload, Meta> {
  const baseShape = {
    type: v.literal(type),
    meta: v.strictObject({ ...defaultMeta, ...meta }), // Strict for meta
  };

  return payload
    ? v.strictObject({ ...baseShape, payload: v.strictObject(payload) }) // Strict at all levels
    : v.strictObject(baseShape); // Strict at root - rejects unexpected 'payload'
}
```

**Rationale:** Strict validation prevents:

- DoS via unbounded unknown fields
- Handler bugs from unexpected data
- Schema drift between client/server
- Wire protocol violations (e.g., sending `payload` when schema defines none)

See docs/specs/test-requirements.md#Runtime-Testing for test requirements.

## Adapter Pattern

Each validator library requires an adapter:

```typescript
// zod/adapter.ts
export const zodAdapter: ValidatorAdapter = {
  getMessageType: (schema) => schema.shape.type.value,
  safeParse: (schema, data) => schema.safeParse(data),
  infer: (schema) => schema._type, // TypeScript only
};
```

**Adapters receive normalized messages** - The base router MUST normalize before calling `safeParse()`.

## Validation Contract

```typescript
safeParse(schema, data): {
  success: boolean;
  data?: ValidatedData;
  error?: ValidationError;
}
```

**MUST return**:

- `success: true` + `data` on valid input
- `success: false` + `error` on invalid input

## Error Handling

| Stage             | Error                | Behavior                            |
| ----------------- | -------------------- | ----------------------------------- |
| JSON parse        | Syntax error         | Log + ignore message                |
| Type check        | Missing `type` field | Log + ignore message                |
| Handler lookup    | No handler found     | Log + ignore message                |
| Normalize         | Invalid structure    | Pass through (validation will fail) |
| Schema validation | Validation failed    | Log + skip handler                  |
| Handler execution | Sync/async error     | Log + keep connection open          |

**Critical**: All errors are logged. Connection stays open unless handler explicitly closes it.

## Message Validation Pipeline

```typescript
// shared/message.ts - MessageRouter.handleMessage()
// Capture ingress timestamp FIRST for accuracy in time-sensitive operations
const receivedAt = Date.now();

try {
  // 1. Parse JSON
  const parsedMessage = JSON.parse(message);

  // 2. Type check
  if (!parsedMessage.type || typeof parsedMessage.type !== "string") {
    console.warn(`Invalid message format`);
    return;
  }

  // 3. Handler lookup
  const handler = messageHandlers.get(parsedMessage.type);
  if (!handler) {
    console.warn(`No handler for type: ${parsedMessage.type}`);
    return;
  }

  // 4. Normalize (security: strip reserved keys, ensure meta exists)
  const normalized = normalizeInboundMessage(parsedMessage);

  // 5. Schema validation (on normalized input)
  const result = validator.safeParse(handler.schema, normalized);
  if (!result.success) {
    console.error(`Validation failed:`, result.error);
    return;
  }

  // 6. Build context (add server-provided fields)
  const ctx = buildContext(result.data, ws, receivedAt);

  // 7. Invoke handler
  handler.handler(ctx);
} catch (error) {
  console.error(`Handler error:`, error);
}
```

## Normalization Rules {#normalization-rules}

**Implementation location**: `shared/message.ts` in `MessageRouter.handleMessage()` (see pipeline code below)

**Requirement:** Handlers MUST NOT observe reserved server-only keys from inbound messages.

Routers MUST strip reserved keys **before** validation to:

- Close spoofing vectors (clients cannot inject server-only fields)
- Keep schemas symmetric (client-side validation works)
- Ensure consistent adapter behavior (all receive sanitized input)

**CANONICAL IMPLEMENTATION** (reference this in code reviews and implementations):

```typescript
// shared/normalize.ts

// Reserved server-only meta keys (MUST be stripped before validation)
// SOURCE: docs/specs/rules.md#reserved-keys
const RESERVED_META_KEYS = new Set(["clientId", "receivedAt"]);
// To reserve additional keys in future, add them here AND update:
// - docs/specs/schema.md#Reserved-Server-Only-Meta-Keys
// - docs/specs/rules.md#reserved-keys

/**
 * Schema Creation Enforcement
 *
 * Adapters MUST validate that extended meta schemas do not define reserved keys.
 * This check occurs in message() helper to fail fast at design time.
 */
function validateMetaSchema(meta?: Record<string, any>): void {
  if (!meta) return;

  const reservedInMeta = Object.keys(meta).filter((k) =>
    RESERVED_META_KEYS.has(k),
  );
  if (reservedInMeta.length > 0) {
    throw new Error(
      `Reserved meta keys not allowed in schema: ${reservedInMeta.join(", ")}. ` +
        `Reserved keys: ${Array.from(RESERVED_META_KEYS).join(", ")}`,
    );
  }
}

// Called in message() before creating schema:
// validateMetaSchema(meta);

/**
 * Normalizes inbound message before validation (security boundary).
 *
 * MUST be called before schema validation to:
 * - Strip reserved server-only keys (prevents spoofing)
 * - Ensure meta exists (allows optional client meta)
 *
 * Mutates in place for performance (hot path, every message).
 * Safe: single-threaded per Bun worker (no concurrent access).
 * O(k) complexity where k = RESERVED_META_KEYS.size (currently 2).
 */
function normalizeInboundMessage(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return raw as any; // Will fail validation
  }

  const msg = raw as Record<string, unknown>;

  // Ensure meta exists (default to empty object)
  if (!msg.meta || typeof msg.meta !== "object" || Array.isArray(msg.meta)) {
    msg.meta = {};
  }

  // Strip reserved server-only keys (security: client cannot set these)
  const meta = msg.meta as Record<string, unknown>;
  for (const key of RESERVED_META_KEYS) {
    delete meta[key];
  }
  // O(k) where k = RESERVED_META_KEYS.size (currently 2)
  // Faster than iterating all meta keys: O(n)

  return msg;
}
```

**Unknown key handling:**

Normalization strips **only** reserved server-only keys (`clientId`, `receivedAt`).

Schema validation **MUST** reject messages with unknown keys (strict mode). This ensures:

1. Handlers only observe schema-defined fields
2. Client-side validation symmetry (same strictness rules)
3. Fast failure on malformed/malicious inputs

See docs/specs/schema.md#Strict-Schemas for implementation requirements.

**Reserved Server-Only Meta Keys**:

- `clientId`: Connection identity (access via `ctx.clientId`)
- `receivedAt`: Server receive timestamp (access via `ctx.receivedAt`)

**Rationale**:

- Clients MUST NOT send reserved server-only keys
- Client-provided fields (`correlationId`, `timestamp`, extended meta) are preserved
- Normalization is transport-layer security boundary

## Context Building

**After validation**, router builds handler context with server-provided fields:

```typescript
// shared/context.ts
function buildContext<T>(
  validated: T,
  ws: ServerWebSocket,  // Per ADR-033: opaque transport only
  connectionData: any,  // Connection state from adapter's initialData
  receivedAt: number  // Captured at message ingress (before parsing)
): MessageContext<...> {
  return {
    ws,
    type: validated.type,
    meta: validated.meta,
    payload: validated.payload,  // Only exists if schema defines it
    receivedAt,                  // Server receive timestamp (ingress time)
    send: createSendFunction(ws),
  };
}
```

**Server-provided context fields**:

- `ctx.clientId`: Connection identity (UUID v7, set during upgrade)
- `ctx.receivedAt`: Server receive timestamp (milliseconds since epoch)

**Why not inject into `meta`**:

- `clientId` is connection state, not message state (already in `ctx.data`)
- `receivedAt` is server ingress time; separate from optional `ctx.meta.timestamp` (producer time)
- Keeps message schema clean and client-side validatable

**Which timestamp to use**: `ctx.receivedAt` is captured at ingress before parsing (server clock, authoritative); `meta.timestamp` is producer time and may be missing or skewed (client's clock, untrusted). **Never** base server decisions on `meta.timestamp`. See docs/specs/schema.md#Which-timestamp-to-use for detailed guidance.

## Plugin Configuration {#plugin-configuration}

Validators are plugged in via `withZod()` or `withValibot()` with optional configuration (see ADR-025):

```typescript
const router = createRouter()
  .plugin(
    withZod({
      validateOutgoing: true, // Default: true; validate ctx.send(), ctx.reply(), ctx.publish()
      coerce: false, // Zod-only; default: false
      onValidationError: async (err, ctx) => {
        // Optional: custom error hook instead of router.onError()
        logger.warn("Validation failed", {
          type: ctx.type,
          direction: ctx.direction, // "inbound" | "outbound"
          code: err.code, // "VALIDATION_ERROR" | "OUTBOUND_VALIDATION_ERROR"
          details: err.details, // Schema error details
        });
      },
    }),
  )
  .on(ChatMessage, (ctx) => {
    // ctx.payload validated and typed
    ctx.send(ReplyMessage, { text: ctx.payload.text });
  });
```

**Options**:

| Option              | Type     | Default   | Description                                                                          |
| ------------------- | -------- | --------- | ------------------------------------------------------------------------------------ |
| `validateOutgoing`  | boolean  | `true`    | Validate payloads in `ctx.send()`, `ctx.reply()`, `ctx.publish()` (performance knob) |
| `coerce`            | boolean  | `false`   | Zod-only; enable schema coercion (e.g., string → number)                             |
| `onValidationError` | function | undefined | Custom error hook; if omitted, routes to `router.onError()`                          |

**Inbound vs Outbound Validation**:

- **Inbound**: Always active; validates `ctx.payload` before handler runs (security critical)
- **Outbound**: Configurable via `validateOutgoing` flag; validates data sent by handler (performance optimization)

Set `validateOutgoing: false` for ultra-hot paths where you trust handler data. Runtime cost: one safeParse call per outbound message when enabled.

## Validator Portability Contract

All validator adapters (Zod, Valibot, custom) must represent the same message envelope at the wire level:

```
{
  type: string,
  meta: { timestamp?, correlationId?, ...extended },
  payload?: T
}
```

**Contract Requirements**:

- The `message()` and `rpc()` helpers in each validator MUST produce schemas that validate this envelope shape
- Custom validators or future adapters MUST normalize incoming messages to this shape before validation
- The type extraction utilities (`InferType`, `InferPayload`, etc.) MUST work consistently across all validators
- Wire-level validation MUST be identical: reject unknown keys, require `type`, enforce payload presence/absence

**Future Validator Support**:

If adding a new validator (e.g., TypeBox, io-ts), ensure:

1. Schemas created by `message()` and `rpc()` match the WS-Kit envelope shape
2. If the validator has its own envelope format, provide a normalization adapter before validation
3. Type inference utilities extract the same types as Zod/Valibot counterparts
4. Add tests verifying wire-level compatibility with existing adapters (see docs/specs/test-requirements.md)

## Key Constraints

> See docs/specs/rules.md for complete rules. Critical for validation:

1. **Normalize before validate** — Strip reserved keys BEFORE schema validation (see docs/specs/validation.md#normalization-rules)
2. **Strict mode required** — Schemas MUST reject unknown keys (see docs/specs/schema.md#Strict-Schemas and #Strict-Mode-Enforcement)
3. **Validation flow** — Follow exact order: Parse → Type Check → Handler Lookup → Normalize → Validate → Handler (see docs/specs/rules.md#validation-flow)
4. **Trust validation** — Handlers MUST NOT re-validate; trust schema (see docs/specs/rules.md#validation-flow)
5. **Error handling** — Log validation failures with `clientId`; keep connections open (see docs/specs/rules.md#error-handling)
