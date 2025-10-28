# @ws-kit/valibot

Valibot validator adapter for `@ws-kit/core`.

## Purpose

`@ws-kit/valibot` provides Valibot-based schema validation and type inference for ws-kit, enabling full TypeScript support for message payloads with discriminated unions.

## What This Package Provides

- **`valibotValidator()`**: Convenience factory using default Valibot configuration
- **`createValibotValidator(v)`**: Advanced factory for custom Valibot instances
- **`messageSchema()`**: Convenience helper for defining typed message schemas
- **`createMessageSchema(v)`**: Advanced factory for custom schema definitions
- **Type overloads**: Full TypeScript inference from schema to handler context
- **Discriminated unions**: Full support for union type narrowing in handlers

## Design Pattern

Two API patterns are supported:

### Simple (Most Users)

```typescript
import { valibotValidator, messageSchema } from "@ws-kit/valibot";
import { WebSocketRouter } from "@ws-kit/core";
import * as v from "valibot";

const router = new WebSocketRouter({ validator: valibotValidator() });
const PingMessage = messageSchema("PING", { text: v.string() });

router.onMessage(PingMessage, (ctx) => {
  // ctx.payload is typed as { text: string }
});
```

### Advanced (Custom Valibot Config)

```typescript
import { createValibotValidator, createMessageSchema } from "@ws-kit/valibot";
import * as v from "valibot";

const customV = { ...v }; // Custom Valibot instance
const validator = createValibotValidator(customV);
const { messageSchema } = createMessageSchema(customV);

// ... same API from here
```

## Platform-Agnostic

This adapter works with **any platform** (`@ws-kit/bun`, `@ws-kit/cloudflare-do`, etc.) without modification.

## Dependencies

- `@ws-kit/core` (required)
- `valibot` (peer) — required in projects using this adapter

## Implementation Status

Phase 4 (coming soon): Complete Valibot validator adapter implementation.
