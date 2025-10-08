# Validation Architecture

**Status**: ✅ Implemented

## Validation vs Application Errors

**This spec covers validation errors** (router rejects malformed messages before handlers run).

For **application errors** (handlers send error messages to clients), see @error-handling.md.

| Error Type              | Where Caught         | Handler Invoked? | Spec               |
| ----------------------- | -------------------- | ---------------- | ------------------ |
| Parse failures          | Router (pre-handler) | ❌ Never         | @validation.md     |
| Schema validation       | Router (pre-handler) | ❌ Never         | @validation.md     |
| Business logic failures | Handler (app code)   | ✅ Always        | @error-handling.md |

**Key distinction**: Validation errors are **transport-layer** concerns (malformed wire format); application errors are **business-layer** concerns (invalid state, unauthorized access, resource not found).

## Flow

```text
Message → JSON Parse → Type Check → Handler Lookup → Normalize → Schema Validation → Handler
```

**Pipeline stages**:

1. **Parse**: JSON.parse() the raw WebSocket message
2. **Type check**: Ensure `type` field exists and is a string
3. **Handler lookup**: Find registered handler for message type
4. **Normalize**: Ensure `meta` exists, strip reserved keys (security)
5. **Validate**: Schema validation on normalized message (strict mode - see below)
6. **Handler**: Invoke handler with validated message + server context

Adapters MUST receive normalized messages for validation.

**Strict mode validation**: Schemas MUST reject unknown keys, including unexpected `payload` when schema defines none. See @schema.md#Strict-Schemas for rationale and #Strict-Mode-Enforcement below for adapter requirements.

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

**Implementation:**

```typescript
// Zod adapter (zod/types.ts)
export function messageSchema<Type extends string, Payload, Meta>(
  type: Type,
  payload?: Payload,
  meta?: Meta,
): ZodMessageSchema<Type, Payload, Meta> {
  const baseShape = {
    type: z.literal(type),
    meta: z.object({ ...defaultMeta, ...meta }),
  };

  const schema = payload
    ? z.object({ ...baseShape, payload: z.object(payload) })
    : z.object(baseShape);

  return schema.strict(); // CRITICAL: Rejects unknown keys including unexpected 'payload'
}

// Valibot adapter (valibot/types.ts)
export function messageSchema<Type extends string, Payload, Meta>(
  type: Type,
  payload?: Payload,
  meta?: Meta,
): ValibotMessageSchema<Type, Payload, Meta> {
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

See @test-requirements.md#Runtime-Testing for test requirements.

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
    console.warn(`[${ws.data.clientId}] Invalid message format`);
    return;
  }

  // 3. Handler lookup
  const handler = messageHandlers.get(parsedMessage.type);
  if (!handler) {
    console.warn(
      `[${ws.data.clientId}] No handler for type: ${parsedMessage.type}`,
    );
    return;
  }

  // 4. Normalize (security: strip reserved keys, ensure meta exists)
  const normalized = normalizeInboundMessage(parsedMessage);

  // 5. Schema validation (on normalized input)
  const result = validator.safeParse(handler.schema, normalized);
  if (!result.success) {
    console.error(`[${ws.data.clientId}] Validation failed:`, result.error);
    return;
  }

  // 6. Build context (add server-provided fields)
  const ctx = buildContext(result.data, ws, receivedAt);

  // 7. Invoke handler
  handler.handler(ctx);
} catch (error) {
  console.error(`[${ws.data.clientId}] Handler error:`, error);
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
// SOURCE: @rules.md#reserved-keys
const RESERVED_META_KEYS = new Set(["clientId", "receivedAt"]);
// To reserve additional keys in future, add them here AND update:
// - @schema.md#Reserved-Server-Only-Meta-Keys
// - @rules.md#reserved-keys

/**
 * Schema Creation Enforcement
 *
 * Adapters MUST validate that extended meta schemas do not define reserved keys.
 * This check occurs in messageSchema() factory to fail fast at design time.
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

// Called in messageSchema() before creating schema:
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

See @schema.md#Strict-Schemas for implementation requirements.

**Reserved Server-Only Meta Keys**:

- `clientId`: Connection identity (access via `ctx.ws.data.clientId`)
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
  ws: ServerWebSocket<WebSocketData<any>>,
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

- `ctx.ws.data.clientId`: Connection identity (UUID v7, set during upgrade)
- `ctx.receivedAt`: Server receive timestamp (milliseconds since epoch)

**Why not inject into `meta`**:

- `clientId` is connection state, not message state (already in `ctx.ws.data`)
- `receivedAt` is server ingress time; separate from optional `ctx.meta.timestamp` (producer time)
- Keeps message schema clean and client-side validatable

**Which timestamp to use**: `ctx.receivedAt` is captured at ingress before parsing (server clock, authoritative); `meta.timestamp` is producer time and may be missing or skewed (client's clock, untrusted). **Never** base server decisions on `meta.timestamp`. See @schema.md#Which-timestamp-to-use for detailed guidance.

## Key Constraints

> See @rules.md for complete rules. Critical for validation:

1. **Normalize before validate** — Strip reserved keys BEFORE schema validation (see @validation.md#normalization-rules)
2. **Strict mode required** — Schemas MUST reject unknown keys (see @schema.md#Strict-Schemas and #Strict-Mode-Enforcement)
3. **Validation flow** — Follow exact order: Parse → Type Check → Handler Lookup → Normalize → Validate → Handler (see @rules.md#validation-flow)
4. **Trust validation** — Handlers MUST NOT re-validate; trust schema (see @rules.md#validation-flow)
5. **Error handling** — Log validation failures with `clientId`; keep connections open (see @rules.md#error-handling)
