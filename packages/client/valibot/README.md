# @ws-kit/client/valibot

Typed WebSocket client with full TypeScript inference from Valibot schemas.

## Installation

Install the base client with Valibot support:

```bash
npm install @ws-kit/client valibot
# or
bun add @ws-kit/client valibot
```

## Quick Start

Define schemas on the server, reuse in the client for zero duplication:

```typescript
// shared/messages.ts
import * as v from "valibot";
import { createMessageSchema } from "@ws-kit/valibot";

const { messageSchema } = createMessageSchema(v);

export const Messages = {
  PING: messageSchema("PING"),
  PONG: messageSchema("PONG", { latency: v.number() }),
  USER: messageSchema("USER", {
    id: v.number(),
    name: v.string(),
    email: v.string([v.email()]),
  }),
};
```

```typescript
// client.ts
import { createClient } from "@ws-kit/client/valibot";
import { Messages } from "./shared/messages";

const client = createClient({ url: "wss://api.example.com" });

// Type-safe handlers
client.on(Messages.PONG, (msg) => {
  // ✅ msg.payload.latency is typed as number
  console.log(`Latency: ${msg.payload.latency}ms`);
});

// Type-safe sending
client.send(Messages.PING);

// Request/response
const pong = await client.request(Messages.PING, Messages.PONG);
console.log(pong.payload.latency);
```

## Features

- **Full type inference** from Valibot schemas
- **Discriminated unions** for multi-message handlers
- **Schema reuse** between server and client
- **Zero runtime overhead** — pure type-level wrapper
- **Request/response patterns** with async/await
- **Auto-reconnection** with exponential backoff
- **Message queueing** while connecting

## API

All methods from `@ws-kit/client` are available with typed signatures. See `@ws-kit/client` documentation for full reference.

Key overloads:

- `on<S>(schema, handler)` — Handler receives typed message
- `send<S>(schema, payload?)` — Payload type checked at compile time
- `request<S, R>(schema, reply)` — Returns typed response promise

## Alternative: Zod

Use `@ws-kit/client/zod` for Zod schemas instead:

```bash
npm install @ws-kit/client zod
```

The API is identical; only the validator library differs.

## See Also

- `@ws-kit/client` — Base client documentation
- `@ws-kit/valibot` — Server-side Valibot adapter
- ws-kit documentation — Full guides and examples

## License

MIT
