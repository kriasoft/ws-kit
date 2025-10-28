# @ws-kit/client

Universal WebSocket client for browsers and Node.js.

## Purpose

`@ws-kit/client` provides a modern, type-safe WebSocket client that works across all JavaScript environments with optional validator integration for schema-based type inference.

## What This Package Provides

- **`createClient()`**: Factory for creating universal WebSocket clients
- **Auto-reconnection**: Exponential backoff with configurable options
- **Message queueing**: Buffer messages while connecting
- **Request/response patterns**: Async message request APIs
- **Authentication helpers**: Built-in token management
- **Platform-agnostic**: Works in browsers, Node.js, Bun, etc.
- **No dependencies**: Core package has zero runtime dependencies

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

## Implementation Status

Phase 5 (coming soon): Complete universal client with auto-reconnection.
Phase 5.5+: Optional validator integration sub-packages.
