# @ws-kit/plugins

Core plugins for WS-Kit routers — framework features that add capabilities via composition.

## Plugins

- **`withMessaging()`** — Fire-and-forget unicast messaging (`ctx.send()`)
- **`withRpc()`** — Request-response with streaming (`ctx.reply()`, `ctx.progress()`)
- **`withPubSub(options)`** — Topic-based broadcasting (`ctx.publish()`, `ctx.topics`)

## Installation

```bash
bun add @ws-kit/plugins
```

## Quick Start

```typescript
import { createRouter, withZod } from "@ws-kit/zod";
import { withPubSub, withRpc } from "@ws-kit/plugins";
import { memoryPubSub } from "@ws-kit/core/adapters/pubsub";

const router = createRouter()
  .plugin(withZod())           // Validation
  .plugin(withRpc())           // Request-response
  .plugin(withPubSub({
    adapter: memoryPubSub(),   // In-memory pub/sub (dev)
  }));

// Handlers now have:
// - ctx.send() — fire-and-forget
// - ctx.publish() — broadcast to topic
// - ctx.reply(), ctx.progress() — RPC responses
```

## Architecture

**Plugins** define framework features; **adapters** provide backend implementations:

- **Memory** (in `@ws-kit/core/adapters`) — For development and testing
- **Redis** (in `@ws-kit/redis`) — For distributed deployments
- **Cloudflare** (in `@ws-kit/cloudflare`) — For Cloudflare Workers

Swap adapters without changing your code:

```typescript
// Development
.plugin(withPubSub({ adapter: memoryPubSub() }))

// Production
.plugin(withPubSub({ adapter: redisPubSub(redis) }))
```

## Convenience Re-exports

For convenience, validator packages re-export these plugins:

```typescript
// ✅ Convenient (recommended)
import { withPubSub, withRpc } from "@ws-kit/zod";

// ✅ Also works (explicit)
import { withPubSub, withRpc } from "@ws-kit/plugins";
```

## Documentation

- **[docs/specs/plugins.md](../../docs/specs/plugins.md)** — Complete plugin documentation
- **[ADR-031: Plugin-Adapter Architecture](../../docs/adr/031-plugin-adapter-architecture.md)** — Design rationale
- **[docs/specs/context-methods.md](../../docs/specs/context-methods.md)** — Context method API reference

## TypeScript

All plugins are fully typed. The type system enforces that:
- Methods only appear after their plugin is registered
- Context is properly enhanced with plugin methods
- Payloads match schema types

## License

MIT
