# @ws-kit/client

Universal WebSocket client for browsers and Node.js.

## Purpose

`@ws-kit/client` provides a modern, type-safe WebSocket client that works across all JavaScript environments with optional validator integration for schema-based type inference.

## What This Package Provides

- **`createClient()`**: Universal WebSocket client factory
- **Auto-reconnection**: Exponential backoff with configurable retry logic
- **Message buffering**: Queues messages while connecting
- **Request/response patterns**: Async APIs for paired message exchanges
- **Token management**: Built-in authentication helpers
- **Universal runtime support**: Browsers, Node.js, Bun, and more
- **Zero dependencies**: Core package has no runtime dependencies

## Optional Validator Integration (Phase 5.5+)

### With Zod Schema Inference

```typescript
import { createClient } from "@ws-kit/client/zod";
import { PingMessage, PongMessage } from "./schemas";

const client = createClient({
  url: "ws://localhost:3000",
  schemas: [PingMessage, PongMessage],
});

client.on("message", (msg) => {
  // msg is typed as PingMessage | PongMessage
  if (msg.type === "PING") {
    // TypeScript narrows to PingMessage
  }
});
```

### With Valibot Schema Inference

```typescript
import { createClient } from "@ws-kit/client/valibot";
import { PingMessage, PongMessage } from "./schemas";

const client = createClient({
  url: "ws://localhost:3000",
  schemas: [PingMessage, PongMessage],
});
```

### Without Validator (Default)

```typescript
import { createClient } from "@ws-kit/client";

const client = createClient({ url: "ws://localhost:3000" });
client.on("message", (msg: unknown) => {
  // msg is typed as unknown; validate manually if needed
});
```

## Dependencies

- **Core**: None (universal)
- **`/zod` variant**: `zod` (peer), `@ws-kit/core` (shared interface)
- **`/valibot` variant**: `valibot` (peer), `@ws-kit/core` (shared interface)

## Design Philosophy

The core client is validator-agnostic for maximum portability. Optional validator sub-packages enable type-safe message handling by re-using server schemas.
