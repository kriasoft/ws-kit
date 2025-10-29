# WS-Kit Examples

This directory contains example implementations demonstrating WS-Kit features and patterns.

## Structure

### [`quick-start/`](./quick-start)

Simple reference examples for getting started with WS-Kit:

- **`schema.ts`** — Define typed message schemas using Zod
- **`auth-schema.ts`** — Authentication schema with Zod v4 validators (JWT, email, URL, etc.)
- **`chat.ts`** — Chat room router with message broadcasting
- **`error-handling.ts`** — Enhanced error handling with Zod v4 validation
- **`client-usage.ts`** — Browser and manual WebSocket client patterns
- **`index.ts`** — Full Hono + WebSocket server setup

**Run the quick-start example:**

```bash
cd examples/quick-start
bun index.ts
```

### [`bun-zod-chat/`](./bun-zod-chat)

Complete chat application demonstrating:

- Full Bun.serve() integration
- Zod schema validation
- Room-based message routing
- Connection lifecycle management

**Run the chat example:**

```bash
cd examples/bun-zod-chat
bun index.ts
```

### [`redis-multi-instance/`](./redis-multi-instance)

Multi-instance deployment example with Redis PubSub:

- Multiple Bun server instances
- Cross-instance message broadcasting
- Redis pub/sub integration
- Load balancer setup

**Run the Redis example:**

```bash
cd examples/redis-multi-instance
bun index.ts
```

### [`typed-client-usage.ts`](./typed-client-usage.ts)

Advanced example showing:

- Type-safe browser client with schema reuse
- Full message type inference
- Client-side request/response patterns
- Schema composition

## Getting Started

Start with [`quick-start/`](./quick-start) for basic patterns, then explore specific examples:

1. **Chat Application** → [`bun-zod-chat/`](./bun-zod-chat)
2. **Distributed Systems** → [`redis-multi-instance/`](./redis-multi-instance)
3. **Type-Safe Client** → [`typed-client-usage.ts`](./typed-client-usage.ts)

## Development

All examples use:

- **Bun** as runtime
- **Zod** for schema validation
- **@ws-kit/** packages from npm (or local workspace)

### Import Pattern

Examples use production-like imports that work in development and after publishing:

```typescript
import { zodValidator } from "@ws-kit/zod";
import { createClient } from "@ws-kit/client/zod";
import { WebSocketRouter } from "@ws-kit/core";
```

In development, these resolve to source files via TypeScript path aliases and Bun mappings. After publishing, npm's module resolution handles the imports identically. See [docs/adr/003-example-imports.md](../docs/adr/003-example-imports.md) for design details.

### Setup & Commands

Install dependencies:

```bash
bun install
```

Type-check all examples:

```bash
bunx tsc --noEmit
```

Run tests:

```bash
bun test
```
