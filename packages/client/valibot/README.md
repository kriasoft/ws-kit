# @ws-kit/client/valibot

Type-safe WebSocket client with full TypeScript inference from Valibot schemas.

## Quick Start

Define schemas on the server, reuse in the client with full type safety:

```typescript
// shared/messages.ts (import once, use everywhere)
import { v, message, rpc } from "@ws-kit/valibot";

// Fire-and-forget messages
export const UserUpdate = message("USER_UPDATE", {
  id: v.number(),
  name: v.string(),
});

// Request/response with RPC (modern approach)
export const Ping = rpc("PING", undefined, "PONG", { latency: v.number() });
```

```typescript
// client.ts
import { wsClient } from "@ws-kit/client/valibot";
import { Ping, UserUpdate } from "./shared/messages";

const client = wsClient({ url: "wss://api.example.com" });

await client.connect();

// Type-safe message handler
client.on(UserUpdate, (msg) => {
  // ✅ msg.payload.id is typed as number
  // ✅ msg.payload.name is typed as string
  console.log(`User ${msg.payload.id}: ${msg.payload.name}`);
});

// Fire-and-forget sending
client.send(UserUpdate, { id: 1, name: "Alice" });

// RPC request/response with auto-detected response (modern)
const response = await client.request(Ping, {}, { timeoutMs: 5000 });
// ✅ response.payload.latency is typed as number (auto-detected from RPC schema)
console.log(`Server latency: ${response.payload.latency}ms`);
```

## Installation

```bash
# Using Valibot (lighter bundles)
bun add @ws-kit/client valibot

# Or with npm
npm install @ws-kit/client valibot
```

## Key Features

- **Full type inference** — Payload, meta, and type are fully typed
- **Schema reuse** — Define once, use on server and client
- **Zero runtime overhead** — Pure type-level wrapper
- **Request/response patterns** — Async/await with timeouts
- **Auto-reconnection** — Exponential backoff by default
- **Message queueing** — Offline messages queued while connecting
- **Discriminated unions** — Type narrowing with multiple message handlers
- **Smaller bundles** — Valibot is 60-80% smaller than Zod for typical usage

## Import Pattern (Critical)

Always import from `@ws-kit/client/valibot`, never mix with direct imports:

```typescript
// ✅ CORRECT: Single canonical source
import { message } from "@ws-kit/valibot";
import { wsClient } from "@ws-kit/client/valibot";

// ❌ AVOID: Mixing imports (causes type mismatches)
import * as v from "valibot"; // Different instance
import { message } from "@ws-kit/valibot"; // Uses @ws-kit/valibot's v
// Result: Type mismatches in handlers
```

## API Reference

The client provides typed overloads for these core methods:

### `on(schema, handler)`

Register a typed message handler:

```typescript
client.on(UserUpdate, (msg) => {
  // msg.type === "USER_UPDATE" (literal)
  // msg.payload.id is number
  // msg.payload.name is string
  console.log(`User ${msg.payload.id}: ${msg.payload.name}`);
});
```

### `send(schema, payload?)`

Send a message (fire-and-forget):

```typescript
// Schema with payload
client.send(UserUpdate, { id: 1, name: "Alice" });

// Schema without payload
client.send(Ping);
```

### `request(schema, payload?, options?)`

Request/response with RPC schemas. Response type is auto-detected from the RPC schema:

```typescript
// RPC-style (recommended): response auto-detected from schema
const response = await client.request(Ping, {}, { timeoutMs: 5000 });
// ✅ response.payload is fully typed from Ping.response

// Traditional style: explicit response schema (backward compatible)
const response = await client.request(Ping, {}, Pong, { timeoutMs: 5000 });
```

### `connect() / disconnect()`

Manage connection lifecycle:

```typescript
await client.connect();
// ... use client ...
await client.disconnect();
```

### `state` / `isConnected`

Query connection status:

```typescript
if (client.isConnected) {
  client.send(Ping);
}

client.onState((state) => {
  console.log(`State: ${state}`);
});
```

## Zod Alternative

For more familiar APIs, use `@ws-kit/client/zod` instead:

```bash
bun add @ws-kit/client zod
```

Import identically—only the validator library changes:

```typescript
// Identical API, just different validator
import { z, message } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";
```

## See Also

- `@ws-kit/valibot` — Server-side Valibot adapter
- `@ws-kit/zod` — Server-side Zod adapter (larger bundles, familiar API)
- `@ws-kit/client` — Base client (for custom validators)

## License

MIT
