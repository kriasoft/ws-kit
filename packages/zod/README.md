# @ws-kit/zod

Zod validator adapter for `@ws-kit/core`.

## Purpose

`@ws-kit/zod` provides Zod-based schema validation and type inference for WS-Kit, enabling full TypeScript support for message payloads with discriminated unions.

## What This Package Provides

- **`zodValidator()`**: Convenience factory using default Zod configuration
- **`createZodValidator(z)`**: Advanced factory for custom Zod instances
- **`messageSchema()`**: Convenience helper for defining typed message schemas
- **`createMessageSchema(z)`**: Advanced factory for custom schema definitions
- **Type overloads**: Full TypeScript inference from schema to handler context
- **Discriminated unions**: Full support for union type narrowing in handlers

## Design Pattern

Two API patterns are supported:

### Simple (Most Users)

```typescript
import { zodValidator, messageSchema } from "@ws-kit/zod";
import { WebSocketRouter } from "@ws-kit/core";
import { z } from "zod";

const router = new WebSocketRouter({ validator: zodValidator() });
const PingMessage = messageSchema("PING", { text: z.string() });

router.onMessage(PingMessage, (ctx) => {
  // ctx.payload is typed as { text: string }
});
```

### Advanced (Custom Zod Config)

```typescript
import { createZodValidator, createMessageSchema } from "@ws-kit/zod";
import { z } from "zod";

const customZ = z.strict(); // Custom Zod instance
const validator = createZodValidator(customZ);
const { messageSchema } = createMessageSchema(customZ);

// ... same API from here
```

## Platform-Agnostic

This adapter works with **any platform** (`@ws-kit/bun`, `@ws-kit/cloudflare-do`, etc.) without modification.

## Dependencies

- `@ws-kit/core` (required)
- `zod` (peer) — required in projects using this adapter

## Implementation Status

Phase 4 (coming soon): Complete Zod validator adapter implementation.
