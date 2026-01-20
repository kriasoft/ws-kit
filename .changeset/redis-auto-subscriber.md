---
"@ws-kit/redis": patch
---

Auto-create subscriber via `duplicate()` for simplified Redis setup

**New behavior**: `redisPubSub(redis)` now auto-creates a subscriber connection via `duplicate()` during `router.pubsub.init()`. This eliminates the need to manually create two connections for most users.

```typescript
// Before (verbose)
const publisher = createClient({ url: REDIS_URL });
const subscriber = createClient({ url: REDIS_URL });
await Promise.all([publisher.connect(), subscriber.connect()]);
const adapter = redisPubSub(publisher, { subscriber });

// After (simple)
const redis = createClient({ url: REDIS_URL });
await redis.connect();
const adapter = redisPubSub(redis); // Auto-creates subscriber
await router.pubsub.init();
```

**Additional changes**:

- Fail-fast validation: throws immediately if `subscriber === publisher` (same connection)
- `start()` is now conditional: only included when subscriber capability exists
- Fixed connection leak on `duplicate().connect()` or `psubscribe()` failure
- Fixed sync exception handling to separate decode errors from callback errors
- Export type changed from `PubSubDriver` to `PubSubAdapter`

**Advanced usage** (read replicas, different auth) still supported:

```typescript
const pub = createClient({ url: REDIS_URL });
const sub = createClient({ url: REDIS_REPLICA_URL });
await Promise.all([pub.connect(), sub.connect()]);
const adapter = redisPubSub(pub, { subscriber: sub });
```
