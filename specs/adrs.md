# Architectural Decision Records

## ADR-001: MessageContext Conditional Payload Typing

**Status**: Implemented

### Decision

Use explicit `keyof` check to conditionally add `payload` to `MessageContext`:

```typescript
export type MessageContext<Schema extends MessageSchemaType, Data> = {
  ws: ServerWebSocket<Data>;
  type: Schema["shape"]["type"]["value"];
  meta: z.infer<Schema["shape"]["meta"]>;
  send: SendFunction;
} & ("payload" extends keyof Schema["shape"]
  ? Schema["shape"]["payload"] extends ZodType
    ? { payload: z.infer<Schema["shape"]["payload"]> }
    : Record<string, never>
  : Record<string, never>);
```

### Rationale

- Prevents `ctx.payload` access on messages without payload
- Checks key existence, not structural compatibility
- Applied to both Zod and Valibot adapters

### Implementation: Type Override for IDE Inference

**Problem**: Base router uses generic types, so TypeScript resolves `ctx.payload` as `any` in inline handlers.

**Solution**: Override `onMessage` in derived classes with validator-specific types:

```typescript
// zod/router.ts
// @ts-expect-error - Intentional override with more specific types for better DX
onMessage<Schema extends ZodMessageSchemaType>(
  schema: Schema,
  handler: ZodMessageHandler<Schema, WebSocketData<T>>,
): this {
  return super.onMessage(schema as any, handler as any);
}
```

**Trade-off**: This creates an LSP violation—derived routers are more restrictive than base. Consequence:

```typescript
// addRoutes requires | any to accept derived router instances
addRoutes(router: WebSocketRouter<T> | any): this
```

Accepts weaker typing in route composition for excellent IDE experience in primary use case (handler registration).

### Constraints for AI Code Generation

1. **NEVER** access `ctx.payload` unless schema explicitly defines payload
2. **ALWAYS** use `ctx.type` for message type
3. Test inline handler inference with `expectTypeOf`

## ADR-002: Typed Client Adapters via Type Overrides

**Status**: ✅ Implemented

### Context

Use type overrides (not separate implementations) for validator-specific clients:

- `/zod/client` exports `createClient()` returning `ZodWebSocketClient` (narrowed types)
- `/valibot/client` exports `createClient()` returning `ValibotWebSocketClient` (narrowed types)
- Generic client remains at `/client` (unchanged runtime, `unknown` handler types)

### Analysis

**Problem**: Generic client handlers infer as `unknown`, breaking type safety:

```typescript
// Generic client (before)
import { createClient } from "bun-ws-router/client";
client.on(HelloOk, (msg) => {
  msg.type; // ❌ Type error: msg is unknown
  msg.payload.text; // ❌ Type error: msg is unknown
});
```

**Solution**: Validator-specific typed clients via type overrides (mirrors ADR-001 server pattern):

- **Consistency**: Matches server's type override approach for inline handler inference
- **Zero runtime cost**: Pure type casts at module boundary, no wrapper logic
- **Maintainability**: Single client implementation, typed facades per validator
- **DX**: Full inference without manual type guards or assertions

### Implementation

```typescript
// zod/client.ts
import { createClient as createGenericClient } from "bun-ws-router/client";
import type { WebSocketClient } from "bun-ws-router/client";

export interface ZodWebSocketClient
  extends Omit<WebSocketClient, "on" | "send" | "request"> {
  // Type-safe overrides with Zod inference
  on<S extends ZodMessageSchema>(
    schema: S,
    handler: (msg: z.infer<S>) => void,
  ): () => void;

  send<S extends ZodMessageSchema>(
    schema: S,
    payload: InferPayload<S>,
    opts?: { meta?: InferMeta<S>; correlationId?: string },
  ): boolean;

  request<S extends ZodMessageSchema, R extends ZodMessageSchema>(
    schema: S,
    payload: InferPayload<S>,
    reply: R,
    opts?: {
      timeoutMs?: number;
      meta?: InferMeta<S>;
      correlationId?: string;
      signal?: AbortSignal;
    },
  ): Promise<z.infer<R>>;
}

export function createClient(opts: ClientOptions): ZodWebSocketClient {
  return createGenericClient(opts) as ZodWebSocketClient;
}
```

Payload conditional typing uses overloads (like server) to enforce payload absence:

```typescript
// zod/types.ts
export type InferPayload<S extends ZodMessageSchema> =
  "payload" extends keyof S["shape"]
    ? z.infer<S["shape"]["payload"]>
    : never; // Not undefined - payload param must be omitted

// Overloads in ZodWebSocketClient
send<S extends ZodMessageSchema & { shape: { payload: any } }>(
  schema: S,
  payload: InferPayload<S>,
  opts?: SendOptions<S>,
): boolean;

send<S extends ZodMessageSchema & { shape: { payload?: never } }>(
  schema: S,
  opts?: SendOptions<S>,
): boolean;
```

### Trade-offs

- **Breaking change**: Import paths change (`/client` → `/zod/client` or `/valibot/client`)
- **LSP variance**: Type override creates same variance as server (ADR-001)
- **Generic client remains**: Users with custom validators opt in via `/client` import
- **Semver**: Requires major version bump (breaking change)

### Migration Path

**Before**:

```typescript
import { createClient } from "bun-ws-router/client";
```

**After**:

```typescript
// Zod users
import { createClient } from "bun-ws-router/zod/client";

// Valibot users
import { createClient } from "bun-ws-router/valibot/client";

// Custom validators (explicit opt-in)
import { createClient } from "bun-ws-router/client";
```

**No other changes required** - runtime behavior identical, types now infer automatically.

### Example: Full Type Inference

```typescript
// With typed client (after)
import { z } from "zod";
import { createMessageSchema } from "bun-ws-router/zod";
import { createClient } from "bun-ws-router/zod/client";

const { messageSchema } = createMessageSchema(z);
const HelloOk = messageSchema("HELLO_OK", { text: z.string() });

const client = createClient({ url: "wss://api.example.com" });

client.on(HelloOk, (msg) => {
  // ✅ msg fully typed: { type: "HELLO_OK", meta: MessageMeta, payload: { text: string } }
  console.log(msg.type); // ✅ "HELLO_OK" (literal type)
  console.log(msg.meta.timestamp); // ✅ number | undefined
  console.log(msg.payload.text.toUpperCase()); // ✅ Type-safe string methods!
});

// Request/response also fully typed
const reply = await client.request(Hello, { name: "Alice" }, HelloOk);
console.log(reply.type); // ✅ "HELLO_OK" (literal)
console.log(reply.payload.text); // ✅ string
```

### Constraints

1. **ALWAYS** use typed clients (`/zod/client`, `/valibot/client`) for Zod/Valibot schemas
2. **NEVER** use generic client (`/client`) unless implementing custom validator
3. **ALWAYS** test inference with `expectTypeOf` (see @testing.md#client-type-inference)
4. **ALWAYS** use overloads for payload conditional typing (not `undefined` parameter)
