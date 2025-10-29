# ADR-002: Typed Client Adapters via Type Overrides

**Status**: ✅ Implemented

## Context

Generic WebSocket clients infer message handlers as `unknown`, breaking type safety. Users need full message type inference based on schema definitions.

## Decision

Use type overrides (not separate implementations) for validator-specific clients:

- `/zod/client` exports `wsClient()` returning `ZodWebSocketClient` (narrowed types)
- `/valibot/client` exports `wsClient()` returning `ValibotWebSocketClient` (narrowed types)
- Generic client remains at `/client` (unchanged runtime, `unknown` handler types)

## Rationale

**Problem**: Generic client handlers infer as `unknown`, breaking type safety:

```typescript
// Generic client (before)
import { createClient } from "@ws-kit/client";
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

## Implementation

```typescript
// zod/client.ts
import { createClient as createGenericClient } from "@ws-kit/client";
import type { WebSocketClient } from "@ws-kit/client";

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

export function wsClient(
  url: string,
  opts?: ClientOptions,
): ZodWebSocketClient {
  return createGenericClient(url, opts) as ZodWebSocketClient;
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

## Trade-offs

- **Breaking change**: Import paths change (`/client` → `/zod/client` or `/valibot/client`)
- **LSP variance**: Type override creates same variance as server (ADR-001)
- **Generic client remains**: Users with custom validators opt in via `/client` import
- **Semver**: Requires major version bump (breaking change)

## Migration Path

**Before (v1.0-1.1)**:

```typescript
import { createClient } from "@ws-kit/client";
const client = createClient({ url: "wss://..." });
```

**After (v1.2+)**:

```typescript
// Zod users
import { wsClient } from "@ws-kit/client/zod";
const client = wsClient({ url: "wss://..." });

// Valibot users
import { wsClient } from "@ws-kit/client/valibot";
const client = wsClient({ url: "wss://..." });

// Custom validators (explicit opt-in)
import { createClient as wsClient } from "@ws-kit/client"; // Can alias if needed
const client = wsClient({ url: "wss://..." });
```

**Why the rename?**

- `wsClient` follows the verb-style naming convention (matches `message()`, `createRouter()`)
- More consistent with industry patterns (e.g., Hono's `hc.client`)
- Clearer intent (creates a WebSocket client)

## Example: Full Type Inference

```typescript
// With typed client (after)
import { z, message, wsClient } from "@ws-kit/client/zod";

const HelloOk = message("HELLO_OK", { text: z.string() });

const client = wsClient("wss://api.example.com");

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

## Constraints

1. **ALWAYS** use typed clients (`@ws-kit/client/zod`, `@ws-kit/client/valibot`) for Zod/Valibot schemas
2. **ALWAYS** import `wsClient` (not `createClient`) from validator-specific packages (v1.2+)
3. **NEVER** use generic client (`@ws-kit/client`) unless implementing custom validator
4. **ALWAYS** test inference with `expectTypeOf`
5. **ALWAYS** use overloads for payload conditional typing (not `undefined` parameter)
