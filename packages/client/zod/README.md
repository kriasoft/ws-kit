# @ws-kit/client/zod

Typed WebSocket client with full TypeScript inference from Zod schemas.

## Installation

Install the base client with Zod support:

```bash
npm install @ws-kit/client zod
# or
bun add @ws-kit/client zod
```

## Quick Start

Define schemas on the server, reuse in the client for zero duplication:

```typescript
// shared/messages.ts
import { z } from "zod";
import { createMessageSchema } from "@ws-kit/zod";

const { messageSchema } = createMessageSchema(z);

export const Messages = {
  PING: messageSchema("PING"),
  PONG: messageSchema("PONG", { latency: z.number() }),
  USER: messageSchema("USER", {
    id: z.number(),
    name: z.string(),
    email: z.string().email(),
  }),
};
```

```typescript
// client.ts
import { createClient } from "@ws-kit/client/zod";
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

- **Full type inference** from Zod schemas
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

## Alternative: Valibot

Use `@ws-kit/client/valibot` for Valibot schemas instead:

```bash
npm install @ws-kit/client valibot
```

The API is identical; only the validator library differs.

## See Also

- `@ws-kit/client` — Base client documentation
- `@ws-kit/zod` — Server-side Zod adapter
- ws-kit documentation — Full guides and examples

## License

MIT
