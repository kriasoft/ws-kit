---
"@ws-kit/redis-pubsub": major
---

**Breaking changes:**

- Complete error API redesign: `RedisPubSubError` → `PubSubError`, with unified `code` and `retryable` properties
- Error types renamed: `RedisConnectionError`, `RedisPublishError`, `RedisSubscribeError` → `PublishError`, `SubscribeError`, with new types `DisconnectedError`, `ConfigurationError`, `MaxSubscriptionsExceededError`
- Redis client interface updated: `subscribe` callback now receives `(message: string | Buffer)` instead of no arguments
- Options API completely redesigned with new `serializer`, `retry`, `maxSubscriptions`, and `logger` configurations
- Removed legacy host/port/password/db/tls options in favor of `url` or `client`
- Default namespace behavior changed (now empty by default)

**Features:**

- Pattern subscriptions support via `pSubscribe()` and `pUnsubscribe()`
- New serialization modes: "json", "text", "binary", or custom encoder/decoder
- Exponential backoff with jitter for reconnection
- Optional observability sink via logger interface
- Custom error classification for retry decisions
- Subscription limit enforcement with `maxSubscriptions`
- Enhanced type exports from index.ts
