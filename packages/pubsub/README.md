# @ws-kit/pubsub

In-memory pub/sub plugin for WS-Kit.

## Installation

```bash
npm install @ws-kit/pubsub
```

## Usage

```typescript
import { createRouter } from "@ws-kit/core";
import { withPubSub, createMemoryAdapter } from "@ws-kit/pubsub";

const router = createRouter().plugin(withPubSub(createMemoryAdapter()));

// Now pub/sub methods are available
router.publish("topic", schema, payload);
```

## Features

- **Lightweight**: Minimal in-memory implementation using Map and Set
- **Type-safe**: Full TypeScript support with capability gating
- **Plugin-based**: Integrates seamlessly with WS-Kit's plugin system
- **Functional**: Plain factory function design, consistent with `createRouter()` and `message()`

## Adapter

`createMemoryAdapter()` returns an object implementing the `PubSubAdapter` interface:

```typescript
export interface PubSubAdapter {
  publish(msg: PubSubMessage): Promise<void>;
  subscribe(clientId: string, topic: string): Promise<void>;
  unsubscribe(clientId: string, topic: string): Promise<void>;
  listTopics(): readonly string[];
  hasTopic(topic: string): boolean;
}
```

## License

MIT
