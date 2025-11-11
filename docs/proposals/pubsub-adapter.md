# Core principles (non-negotiables)

- **One job:** adapters manage a **local subscription index** and **trigger distributed propagation**; they **never** write WebSocket frames.
- **Router delivers:** the router/session-registry sends frames to clients; adapters only tell us _who_ (local) and _when_ (remote event arrived).
- **Local stats only:** any counts are **process-local**; never promise global truth.
- **Idempotent mutations:** `subscribe`/`unsubscribe` do not return booleans; they throw only on real failures.
- **Tiny surface:** just what every backend needs—no capability flags, no delivery hooks in the adapter.

# Final, lean interfaces

```ts
// ——— Shared types ———
export type Topic = string;
export type ClientId = string;

export interface PublishEnvelope {
  topic: Topic; // normalized
  payload: unknown; // schema-validated upstream
  type?: string; // e.g. schema name for telemetry
  meta?: Record<string, unknown>; // app-level hints (traceId, userId, …)
}

export interface PublishOptions {
  partitionKey?: string; // advisory; e.g. sharding hint
  // no excludeSelf here (router concern)
  // no AbortSignal here (publish should be quick & fire-and-forget-ish)
}

export interface PublishResult {
  matchedLocal: number; // exact for memory; best-effort/0 for distributed
  capability: "exact" | "estimate" | "unknown"; // always LOCAL semantics
}

// ——— The adapter every backend implements ———
export interface PubSubAdapter {
  // Trigger broadcast side-effects (e.g., broker publish) and report LOCAL stats.
  publish(
    envelope: PublishEnvelope,
    opts?: PublishOptions,
  ): Promise<PublishResult>;

  // Local index maintenance (idempotent; throw only on real failure).
  subscribe(clientId: ClientId, topic: Topic): Promise<void>;
  unsubscribe(clientId: ClientId, topic: Topic): Promise<void>;

  // Router uses this for actual delivery (lazy async iterable, no materialization).
  getLocalSubscribers(topic: Topic): AsyncIterable<ClientId>;

  // Optional local introspection (best-effort, local-only).
  listTopics?(): Promise<readonly Topic[]>;
  hasTopic?(topic: Topic): Promise<boolean>;

  // Lifecycle (optional).
  close?(): Promise<void>;

  /**
   * For distributed adapters only:
   * Register a handler invoked when a REMOTE publish arrives via the broker.
   * Memory adapters never call it. Returns an unsubscribe/teardown function.
   */
  onRemotePublished?(
    handler: (envelope: PublishEnvelope) => void | Promise<void>,
  ): () => void;
}
```

### Why this is “ultimate clean”

- **One interface** covers all three targets. No split types, no capability flags, no delivery coupling.

- **Distributed ready** via a single optional hook: `onRemotePublished`.

- **Router stays sovereign**: adapters never see sockets or frames.

---

# Package-level factories (names, signatures)

- **Memory**: `@ws-kit/adapters/memory`

```ts
export function memoryPubSub(): PubSubAdapter;
```

- **Redis**: `@ws-kit/adapters/redis`

```ts
export interface RedisPubSubOptions {
  /** channel naming / prefixing / serializer override if needed */
  channelPrefix?: string; // default: ''
  encode?: (e: PublishEnvelope) => string; // default: JSON.stringify
  decode?: (s: string) => PublishEnvelope; // default: JSON.parse
  patternSubscribeAll?: boolean; // default: true (psubscribe prefix + '*')
}
export function redisPubSub(
  redis: {
    publish: (ch: string, msg: string) => Promise<any> /* plus sub API */;
  },
  opts?: RedisPubSubOptions,
): PubSubAdapter;
```

- **Cloudflare Durable Objects**: `@ws-kit/adapters/cloudflare`

```ts
export interface CloudflareDOPubSubOptions {
  path?: string; // default: '/publish'
  encode?: (e: PublishEnvelope) => string; // default: JSON.stringify
  decode?: (s: string) => PublishEnvelope; // if consuming via DO alarms/webhooks
}
export function cloudflareDurableObjectsPubSub(
  ns: DurableObjectNamespace,
  opts?: CloudflareDOPubSubOptions,
): PubSubAdapter;
```

> Naming is consistent (`pubsub-<backend>`), factories are noun-verb simple (`<backend>PubSub()`), and all return the **same** `PubSubAdapter`.

---

# Minimal reference implementations (concise)

### 1) `memoryPubSub()`

```ts
export function memoryPubSub(): PubSubAdapter {
  const byTopic = new Map<Topic, Set<ClientId>>();

  return {
    async publish(e) {
      const matchedLocal = byTopic.get(e.topic)?.size ?? 0;
      return { matchedLocal, capability: "exact" };
    },
    async subscribe(id, topic) {
      let set = byTopic.get(topic);
      if (!set) byTopic.set(topic, (set = new Set()));
      set.add(id);
    },
    async unsubscribe(id, topic) {
      const set = byTopic.get(topic);
      if (!set) return;
      set.delete(id);
      if (!set.size) byTopic.delete(topic);
    },
    async *getLocalSubscribers(topic) {
      const subscribers = byTopic.get(topic);
      if (subscribers) {
        for (const id of subscribers) yield id;
      }
    },
    async listTopics() {
      return Object.freeze(Array.from(byTopic.keys()));
    },
    async hasTopic(topic) {
      return byTopic.has(topic);
    },
  };
}
```

### 1) `redisPubSub()`

```ts
export function redisPubSub(
  redis: any,
  opts: RedisPubSubOptions = {},
): PubSubAdapter {
  const {
    channelPrefix = "",
    encode = JSON.stringify,
    decode = JSON.parse,
    patternSubscribeAll = true,
  } = opts;

  const local = memoryPubSub();
  let unlisten: (() => void) | undefined;

  const channelFor = (t: Topic) => `${channelPrefix}${t}`;

  const adapter: PubSubAdapter = {
    async publish(e, { partitionKey } = {}) {
      // distributed side-effect
      await redis.publish(channelFor(e.topic), encode(e));
      // local stats (don't assume we also receive our own message)
      let matchedLocal = 0;
      for await (const _id of local.getLocalSubscribers(e.topic)) {
        matchedLocal++;
      }
      return { matchedLocal, capability: "unknown" };
    },

    subscribe: (id, topic) => local.subscribe(id, topic),
    unsubscribe: (id, topic) => local.unsubscribe(id, topic),
    getLocalSubscribers: (topic) => local.getLocalSubscribers(topic),
    listTopics: local.listTopics?.bind(local),
    hasTopic: local.hasTopic?.bind(local),

    onRemotePublished(handler) {
      // Use psubscribe if available, otherwise subscribe per topic as they appear.
      const stop = patternSubscribeAll
        ? redis.psubscribe(
            `${channelPrefix}*`,
            async (msg: string /*, ch: string*/) => {
              handler(decode(msg));
            },
          )
        : wirePerTopic(redis, channelPrefix, handler, decode, local);
      unlisten = stop;
      return stop;
    },

    async close() {
      unlisten?.();
      await redis.quit?.();
    },
  };

  return adapter;
}

// helper to subscribe only to topics that exist locally
function wirePerTopic(
  redis: any,
  prefix: string,
  handler: (e: PublishEnvelope) => void | Promise<void>,
  decode: (s: string) => PublishEnvelope,
  local: PubSubAdapter,
) {
  const subs = new Set<string>();
  const add = async (t: Topic) => {
    const ch = `${prefix}${t}`;
    if (subs.has(ch)) return;
    subs.add(ch);
    await redis.subscribe(ch, (msg: string) => handler(decode(msg)));
  };
  const remove = async (t: Topic) => {
    const ch = `${prefix}${t}`;
    if (!subs.has(ch)) return;
    subs.delete(ch);
    await redis.unsubscribe(ch);
  };
  // naive wiring: poll local.listTopics() occasionally; or expose hooks on router to add/remove
  const interval = setInterval(async () => {
    const topics = new Set(await (local.listTopics?.() ?? []));
    for (const t of topics) await add(t);
    for (const ch of Array.from(subs)) {
      const topic = ch.slice(prefix.length);
      if (!topics.has(topic)) await remove(topic);
    }
  }, 1000);

  return () => {
    clearInterval(interval);
    subs.clear();
  };
}
```

### 3) `durableObjectsPubSub()`

```ts
export function durableObjectsPubSub(
  ns: DurableObjectNamespace,
  opts: DurableObjectsPubSubOptions = {},
): PubSubAdapter {
  const { path = "/publish", encode = JSON.stringify } = opts;
  const local = memoryPubSub();

  return {
    async publish(e) {
      const id = ns.idFromName(e.topic);
      const stub = ns.get(id);
      await stub.fetch(path, { method: "POST", body: encode(e) });
      let matchedLocal = 0;
      for await (const _id of local.getLocalSubscribers(e.topic)) {
        matchedLocal++;
      }
      return { matchedLocal, capability: "unknown" };
    },

    subscribe: (id, topic) => local.subscribe(id, topic),
    unsubscribe: (id, topic) => local.unsubscribe(id, topic),
    getLocalSubscribers: (topic) => local.getLocalSubscribers(topic),
    listTopics: local.listTopics?.bind(local),
    hasTopic: local.hasTopic?.bind(local),

    // In your DO class, call this router-level handler via an alarm or WebSocket/broadcast API.
    onRemotePublished(handler) {
      // On Cloudflare, you typically push from the DO to app instances via
      // DurableObject alarms, WebSocket broadcasts, or Cf Pub/Sub.
      // Wire that plumbing to call `handler(envelope)`.
      // Here we just return a NOP disposer.
      return () => {};
    },
  };
}
```

> Note: Cloudflare has multiple patterns (Durable Objects, Queues, Pub/Sub). The surface above remains the same; only the `publish`/`onRemotePublished` internals change.

---

# Router integration (simple & consistent)

```ts
// During setup:
const adapter = process.env.REDIS_URL
  ? redisPubSub(redisClient)
  : memoryPubSub();

const disposeRemote = adapter.onRemotePublished?.(async (envelope) => {
  await deliverLocally(envelope); // use the same code-path as local publish
});

// On publish handler (router-level):
async function publish(
  topic: string,
  schema: any,
  payload: any,
  opts?: { excludeSelf?: boolean },
) {
  const envelope: PublishEnvelope = { topic, payload, type: schema.type };
  const res = await adapter.publish(envelope);

  // serialize once and deliver to local matches
  const frame = JSON.stringify({
    t: envelope.type,
    p: envelope.payload,
    m: envelope.meta,
  });
  for await (const id of adapter.getLocalSubscribers(topic)) {
    if (opts?.excludeSelf && id === ctx.clientId) continue;
    sessions.get(id)?.send(frame);
  }

  return res; // local-only stats
}
```

# DX checklists (naming, semantics, tests)

- **Naming**
  - Packages: `@ws-kit/pubsub-memory`, `@ws-kit/pubsub-redis`, `@ws-kit/pubsub-cloudflare`
  - Factories: `memoryPubSub()`, `redisPubSub()`, `cloudflareDurableObjectsPubSub()`
  - Core: `PubSubAdapter`, `PublishEnvelope`, `PublishResult`, `PublishOptions`
- **Semantics**
  - “Adapters never deliver WebSocket frames.”
  - `matchedLocal` is **local-only**.
  - `subscribe`/`unsubscribe` **throw** on real errors; otherwise silent/idempotent.
  - `onRemotePublished` is **optional**; memory never calls it.
- **Tests (happy path & edge)**
  - Memory: subscribe/unsubscribe, list/has, publish returns exact counts, getLocalSubscribers iterates lazily.
  - Redis: publishes out; `onRemotePublished` is invoked when remote node sends; local iteration works.
  - DO: publish calls DO; `onRemotePublished` invoked via simulated alarm; local iteration works.
  - Router: excludeSelf filtered during iteration; async iterable streaming supports backpressure.
