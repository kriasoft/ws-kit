# WS-Kit Examples

This directory contains example implementations demonstrating WS-Kit features and patterns.

## Structure

### [`quick-start/`](./quick-start)

Simple reference examples for getting started with WS-Kit:

- **`schema.ts`** — Define typed message schemas using the `message()` helper
- **`auth-schema.ts`** — Authentication schema with Zod v4 validators (JWT, email, URL, etc.)
- **`chat.ts`** — Chat room router with middleware, message broadcasting, and subscription patterns
- **`error-handling.ts`** — Enhanced error handling with Zod v4 validation and middleware
- **`client-usage.ts`** — Type-safe browser client patterns with `@ws-kit/client/zod`
- **`index.ts`** — Full WebSocket server setup using `serve()` helper with route composition

**Run the quick-start example:**

```bash
cd examples/quick-start
bun index.ts
```

### [`bun-zod-chat/`](./bun-zod-chat)

Complete chat application demonstrating:

- Full Bun.serve() integration with custom HTTP routing
- Type-safe message schemas using `message()` helper
- Room-based pub/sub with typed message publishing
- Connection lifecycle hooks (onOpen, onClose, onError)
- Global and per-route middleware
- Stats endpoint for monitoring
- Embedded HTML client with real-time chat UI

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

### [`delta-sync/`](./delta-sync)

Revision-based state synchronization example perfect for collaborative apps:

- Operation history with ring buffer
- Delta sync (send only changes) vs. snapshot sync
- Optimistic updates on client with server reconciliation
- Heartbeat-based stale connection cleanup
- Bandwidth-efficient state replication

**Files:**

- **`server.ts`** — Server with operation tracking and revision management
- **`client.ts`** — Client-side state management with optimistic updates
- **`schema.ts`** — Message schemas for delta protocol
- **`ring-buffer.ts`** — Circular buffer for operation history

**Run the delta-sync example:**

```bash
bun examples/delta-sync/server.ts
```

Run conformance tests:

```bash
bun test examples/delta-sync/conformance.test.ts
```

### [`state-channels/`](./state-channels)

Reliable FIFO state updates with client sequence tracking and recovery from gaps:

- Message sequence numbering for idempotent delivery
- Gap detection and catch-up recovery
- Duplicate message handling (silent ack)
- Conformance tests validating protocol semantics

**Run conformance tests:**

```bash
bun test examples/state-channels/conformance.test.ts
```

### [`flow-control/`](./flow-control)

Backpressure strategies (drop-oldest, drop-new, queue) with server retry hints:

- Queue overflow policies with configurable strategies
- Retry hint protocol with `retryAfterMs`
- Queue depth monitoring and metrics
- Conformance tests for each backpressure strategy

**Run conformance tests:**

```bash
bun test examples/flow-control/conformance.test.ts
```

### [`typed-client-usage.ts`](./typed-client-usage.ts)

Advanced client example showing:

- Type-safe browser client with `@ws-kit/client/zod`
- Full message type inference from schemas
- Request/response patterns with timeout
- Message sending with extended metadata
- Generic fallback pattern without schema types

## Getting Started

Start with [`quick-start/`](./quick-start) to learn the basics, then choose your use case:

**1. Simple Chat** → [`quick-start/`](./quick-start)

- Entry point for learning message schemas, routing, and publishing

**2. Full-Featured Chat** → [`bun-zod-chat/`](./bun-zod-chat)

- Real-world chat with middleware, lifecycle hooks, HTTP endpoints, and HTML client

**3. Scaling to Multiple Servers** → [`redis-multi-instance/`](./redis-multi-instance)

- Cross-instance messaging with Redis pub/sub for distributed deployments

**4. Collaborative Apps** → [`delta-sync/`](./delta-sync)

- Bandwidth-efficient state sync with operations history and optimistic updates

**5. Reliable FIFO Updates** → [`state-channels/`](./state-channels)

- Message sequencing with gap detection and recovery for reliable state channels

**6. Backpressure Handling** → [`flow-control/`](./flow-control)

- Queue overflow strategies with retry hints for resource-constrained scenarios

**7. Browser Clients** → [`typed-client-usage.ts`](./typed-client-usage.ts)

- Type-safe client implementation using `@ws-kit/client/zod`

## Development

All examples use:

- **Bun** as runtime
- **Zod** for schema validation
- **@ws-kit/** packages from npm (or local workspace)

### Import Pattern

Examples use the "export-with-helpers" pattern for canonical imports from a single source:

```typescript
// ✅ All imports from one place - prevents dual-package hazards
import { z, message, createRouter } from "@ws-kit/zod";
import { v, message, createRouter } from "@ws-kit/valibot";

// ✅ Platform-specific handlers
import { serve, createBunHandler } from "@ws-kit/bun";
```

In development, these resolve to source files via TypeScript path aliases and Bun mappings. After publishing, npm's module resolution handles the imports identically. See [docs/adr/007-export-with-helpers-pattern.md](../docs/adr/007-export-with-helpers-pattern.md) for design details.

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
