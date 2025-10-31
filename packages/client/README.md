# @ws-kit/client

Universal WebSocket client for WS-Kit, compatible with browsers and Node.js.

## Purpose

`@ws-kit/client` provides a modern, type-safe WebSocket client for WS-Kit that works across all JavaScript environments with optional validator integration for schema-based type inference.

## What This Package Provides

- **`createClient()`**: Universal WebSocket client factory (base package)
- **`wsClient()`**: Type-safe client with validator integration (zod/valibot sub-packages)
- **Auto-reconnection**: Exponential backoff with configurable retry logic
- **Message buffering**: Queues messages while connecting
- **Request/response patterns**: Async APIs for paired message exchanges
- **Token management**: Built-in authentication helpers
- **Universal runtime support**: Browsers, Node.js, Bun, and more
- **Zero dependencies**: Core package has no runtime dependencies

## Recommended Usage: Validator-Specific Clients

### With Zod Schema Inference

```typescript
import { z, message, wsClient } from "@ws-kit/client/zod";

const PingMessage = message("PING", { text: z.string() });
const PongMessage = message("PONG", { reply: z.string() });

const client = wsClient({ url: "ws://localhost:3000" });

client.on(PingMessage, (msg) => {
  // ✅ msg fully typed with payload: { text: string }
  console.log(msg.payload.text);
});

client.on(PongMessage, (msg) => {
  // ✅ msg fully typed with payload: { reply: string }
  console.log(msg.payload.reply);
});
```

### With Valibot Schema Inference

```typescript
import { v, message, wsClient } from "@ws-kit/client/valibot";

const PingMessage = message("PING", { text: v.string() });
const PongMessage = message("PONG", { reply: v.string() });

const client = wsClient({ url: "ws://localhost:3000" });

client.on(PingMessage, (msg) => {
  // ✅ msg fully typed with payload: { text: string }
  console.log(msg.payload.text);
});
```

### Without Validator (Base Client)

```typescript
import { createClient } from "@ws-kit/client";

const client = createClient({ url: "ws://localhost:3000" });

// Messages typed as unknown without schema validation
client.on(unknownSchema, (msg: unknown) => {
  // Manual validation required
});
```

## Dependencies

- **Core**: None (universal)
- **`/zod` variant**: `zod` (peer)
- **`/valibot` variant**: `valibot` (peer)

## Design Philosophy

The core client is validator-agnostic for maximum portability. Optional validator sub-packages enable type-safe message handling by re-using server schemas.
