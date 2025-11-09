# ADR-022: Namespace-First Pub/Sub API with ReadonlySet State

**Status**: Accepted
**Date**: 2025-11-09
**Tags**: pub/sub, api-design, state-management

## Context

WS-Kit needed a pub/sub API that is:

1. **Portable** across adapters (Bun native, Node/uWS polyfill, Cloudflare DO, etc.)
2. **Type-safe** (consistent with WS-Kit's philosophy of compile-time guarantees)
3. **Ergonomic** (minimal ceremony, intuitive semantics)
4. **Extensible** (room for patterns, presence, multi-process adapters)

### Prior Design Issues

The initial draft spec (`docs/specs/pubsub.md` v1) had several problems:

1. **Namespace confusion** — `ctx.pubsub.subscribe()` with nested `ctx.pubsub.subscriptions.list()` felt awkward and incoherent
2. **Boolean return semantics** — `Promise<boolean>` on idempotent operations was anti-idiomatic. Returns `false` on duplicate subscribe created ambiguity: "what does false mean? Error? Already subscribed? Both?"
3. **No batch operations** — Required O(n) awaits for room join patterns. Partial failure possible (topics 1-5 succeed, 6 fails, inconsistent state)
4. **Zero type safety** — Topics were opaque strings. No schema validation, no compile-time safety (vs message routing which is fully typed)
5. **Heavy middleware** — Proposed middleware pattern felt over-engineered for common case
6. **Unclear authorization timing** — When do hooks run relative to idempotency checks?
7. **Subscribe/unsubscribe asymmetry unclear** — State mutation (subscribe) vs transient action (publish) conflated in same namespace

### Design Space Explored

We evaluated 9+ architectural approaches (documented in detailed analysis), including:

- Flat methods (`ctx.subscribe()` - deprecated in favor of namespaced approach)
- Fluent chains (`ctx.topics.subscribe().with().commit()`)
- Heavy router registration (like `.on()` and `.rpc()`)
- Boolean returns vs void
- Custom `subscriptions` interface vs native Set
- `subscriberCount()` API vs capability hints
- Mandatory typed topics vs optional
- Complex middleware vs lightweight hooks

**Key constraint**: Must feel idiomatic in modern JavaScript/TypeScript, align with WS-Kit's existing patterns (message routing, validator adapters), and leave room for future extensions (patterns, presence, Redis adapter).

## Decision

> **🎯 Rule of Thumb: Mutations throw; actions return.**
>
> State changes (subscribe/unsubscribe) signal errors via exceptions. Transient operations (publish) return results for pattern matching on remediation. Single rule, easy to remember.

### Canonical References

For the **authoritative API surface and implementation invariants**, see [`docs/specs/pubsub.md`](../specs/pubsub.md):

- **Sections 1-10**: API surface, semantics, examples, invariants (normative)
- **Section 11**: Implementation invariants for adapter authors (canonical)
- **Sections 12-15**: Adapter compliance, concurrency, future extensions

This ADR provides the **design rationale** behind these decisions (why we chose this approach).

---

### 1. Namespace: `ctx.topics` (State) + Flat `ctx.publish()` (Action)

```typescript
// State mutation: isolated in namespace
await ctx.topics.subscribe(topic);
await ctx.topics.unsubscribe(topic);
await ctx.topics.subscribeMany([...]);
ctx.topics.has(topic);
[...ctx.topics]; // Iterable

// Action: flat, asymmetry intentional
await ctx.publish(topic, schema, payload);
```

**Why this split:**

- **Conceptual clarity**: Subscribe = state change (persistent, tracked), Publish = transient action (fire-and-forget broadcast)
- **Context cleanliness**: `ctx.*` not polluted with subscription methods; preserves room for future state (presence, session info, etc.)
- **Asymmetry is intentional**: Encourages correct mental model—you manage subscriptions, you send messages

### 2. State Type: `ReadonlySet<string>` (Not Custom Interface)

```typescript
interface Topics extends ReadonlySet<string> {
  subscribe(topic: string): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  subscribeMany(
    topics: Iterable<string>,
  ): Promise<{ added: number; total: number }>;
  unsubscribeMany(
    topics: Iterable<string>,
  ): Promise<{ removed: number; total: number }>;
  clear(): Promise<{ removed: number }>;
}
```

**Why native Set:**

- **Zero overhead**: No wrapper serialization, caching, or custom interface to learn
- **Familiar API**: `.has()`, `.size`, `.forEach()`, `for...of`, spread operator work natively
- **Immutable contract**: `ReadonlySet` enforces "don't mutate directly; use methods"
- **Type clarity**: TypeScript automatically knows `.has()` exists; no custom interface doc needed
- **Scalable**: Other state management (presence, session) can follow same pattern

**Not a custom interface:**

```typescript
// ❌ Rejected: Custom interface forces custom implementation
interface Subscriptions {
  list(): readonly string[];
  has(topic: string): boolean;
}
```

This required users to learn a one-off API; `ReadonlySet` is already known.

### 3. Return Type: `Promise<void>` + Throw on Error

```typescript
// Idempotent: safe to call multiple times, no error
await ctx.topics.subscribe("room:123");
await ctx.topics.subscribe("room:123"); // ✅ No-op, no error

// Error: throw, always
try {
  await ctx.topics.subscribe("room:INVALID");
} catch (e) {
  if (e instanceof PubSubError) {
    // Handle authorization, validation, connection errors
  }
}
```

**Why `Promise<void>` + throw:**

- **Idiomatic async/await**: Callers don't inspect return values; they await or error-handle
- **Boolean returns are anti-pattern**: `const changed = await subscribe()` — what does `false` mean? Not an error, but not a success either. Ambiguous.
- **Errors are exceptional**: Validation failures, authorization denials, connection closures—these should throw
- **No defensive checks needed**: Apps can unconditionally call `subscribe()` without `if (!has(topic))` guards
- **Idempotency is implicit contract**: Not signaled by return value; documented as behavior

**Comparison:**

```typescript
// ❌ Rejected: Boolean return
const stateChanged = await ctx.topics.subscribe(topic);
// Callers ask: "What does false mean? Already subscribed? Error? Both?"

// ✅ Selected: Void return + throw
try {
  await ctx.topics.subscribe(topic); // Always succeeds (idempotent) or throws
} catch (e) {
  // Handle error
}
```

### 4. Batch Operations: Atomic (All-or-Nothing)

```typescript
// Either all succeed, or all fail; no partial state
const result = await ctx.topics.subscribeMany(["room:a", "room:b", "room:c"]);
// Returns { added: 3, total: 7 } OR throws if any topic fails

// Same for unsubscribe
const result = await ctx.topics.unsubscribeMany([...]);
// Returns { removed: 2, total: 5 } OR throws
```

**Why atomic:**

- **Prevents inconsistent state**: Partial failure (rooms 1-2 subscribed, 3 failed) leaves app in undefined state
- **Single round-trip**: One await for many operations (vs O(n) awaits in loop)
- **Consistent with database transactions**: Apps expect atomic or nothing
- **Simplifies error handling**: One error means entire batch failed; no need to track partial success

**Cost**: Adapters must implement transactional semantics (validate all before mutating any). Worth it for correctness.

### 5. Optional Typed Topics via `topic()` Helper

```typescript
// Simple case: just strings, no validation
await ctx.topics.subscribe(`room:${roomId}`);

// Complex case: optional type-safe schema
const RoomTopic = topic(
  "room",
  z.object({ roomId: z.string().uuid() }),
  ({ roomId }) => `room:${roomId}`,
);

await ctx.topics.subscribe(RoomTopic.make({ roomId })); // Validated at call-time
```

**Why optional:**

- **Zero runtime cost if unused**: `topic()` compiles to strings; no wrapper overhead
- **Progressive adoption**: Start simple (strings), migrate to types incrementally
- **No false ceremony**: Not forcing schema for every topic when `"room:123"` is self-explanatory
- **Aligns with WS-Kit philosophy**: Type safety when you need it, not mandatory

**Why not mandatory typed topics:**

```typescript
// ❌ Rejected: Heavy schema requirement
const every = topic("heartbeat", z.void(), () => "system:heartbeat");
// Boilerplate for simple, dynamic topics

// ✅ Selected: Optional
await ctx.topics.subscribe("system:heartbeat"); // Fine
```

### 6. Lightweight Hooks, Not Heavy Middleware

```typescript
router.use(
  usePubSub({
    normalize: (t) => t.toLowerCase(),
    validate: (t) => /^[a-z0-9:_-]{1,128}$/.test(t) || "INVALID_TOPIC",
    authorizeSubscribe: (ctx, topic) => canAccess(ctx.user, topic),
    onSubscribe: (ctx, topic) => logger.info(`Subscribed: ${topic}`),
  }),
);
```

**Why hooks, not router registration:**

```typescript
// ❌ Rejected: Heavy (like router.on() / router.rpc())
router.topic(RoomTopic, {
  authorize: (ctx, { roomId }) => canAccess(ctx.user, roomId),
  onSubscribe: (ctx, { roomId }) => {
    /* ... */
  },
  onPublish: (ctx, { roomId }, msg) => {
    /* ... */
  },
});
// Boilerplate for simple authorization

// ✅ Selected: Lightweight hooks
router.use(
  usePubSub({
    authorizeSubscribe: (ctx, topic) => canAccess(ctx.user, topic),
  }),
);
// Minimal ceremony for common case; still extensible via separate ADR if needed
```

**Rationale:**

- Most apps don't need per-topic lifecycle hooks
- Hooks installed once, apply uniformly to all topics
- Keep common case simple; heavy patterns are future extension (ADR-023+)

### 7. Semantics: Strict Order of Operations

**Normative specification: See [docs/specs/pubsub.md section 6.1](../specs/pubsub.md#61-order-of-checks-normative)**

Every subscription operation follows this invariant (canonical order in spec; repeated here for clarity):

```typescript
// Every operation follows invariant:
// 1. Normalize(topic)
// 2. Validate(normalized)
// 3. Authorize(normalized)
// 4. Idempotency check (return early if already subscribed, no hooks)
// 5. Mutate state
// 6. Call hooks (if state changed)
```

**Why this order:**

- **TOCTOU prevention**: Authorization checks normalized topic, not raw input
- **Idempotency clarity**: Hooks only fire on state changes (not on duplicate subscribe)
- **Predictable side effects**: Hooks run after mutation succeeds (state is consistent)
- **No drift**: Spec is normative; this ADR enforces the same order in all adapters

### 8. Error Model: Subscribe Throws, Publish Returns (with Retryability Hint)

```typescript
// Subscriptions throw on error (state mutations need strong signals)
try {
  await ctx.topics.subscribe(topic);
} catch (err) {
  if (err instanceof PubSubError) {
    // Handle: validation, ACL, state, connection errors
  }
}

// Publish returns result with actionable retryability hint
const result = await ctx.publish(topic, schema, data);
if (result.ok) {
  logger.info(`published to ${result.matched ?? "?"} subscribers`);
} else if (result.retryable) {
  // Schedule retry with exponential backoff
  scheduleRetry(topic, data, exponentialBackoff());
} else {
  // Fail-fast: don't retry validation, ACL, or unsupported errors
  logger.error(`publish failed (${result.error})`, result.details);
}
```

**Rationale:**

- **State mutations throw**: `subscribe()` changes connection state; throw provides strong, explicit error signal
- **Transient actions return**: `publish()` broadcasts messages; return enables predictable, result-based error handling
- **Memorable pattern**: "Mutations throw, actions return"—single rule users can memorize
- **Retryable hint is actionable**: `retryable: boolean` tells callers whether to retry without switch statements. Eliminates boilerplate in every publish call.
- **Never throws**: `publish()` won't reject for runtime conditions (validation, ACL, state, backpressure), reducing try/catch ceremony for normal operation

## Consequences

### Benefits

✅ **Clear semantic separation** — State (topics) vs action (publish) are distinct concepts
✅ **Predictable error handling** — Subscribe throws; publish returns; "mutations throw, actions return"
✅ **Idiomatic async/await** — `Promise<void>` + throw matches modern JS
✅ **Zero overhead** — `ReadonlySet<string>` is native; no wrapper
✅ **Prevents inconsistent state** — Atomic batches, strict operation order
✅ **Actionable remediation** — `retryable: boolean` eliminates boilerplate; no switch statements needed in every publish call
✅ **Progressive type safety** — Optional `topic()` helper, not mandatory
✅ **Lightweight for common case** — Hooks vs heavy middleware
✅ **Extensible** — Room for patterns, presence, Redis adapters (separate ADRs)
✅ **Portable** — Identical semantics across Bun, Node/uWS, Cloudflare DO
✅ **Idempotent by default** — Apps don't need defensive `if (!has())` checks

### Trade-offs

⚠️ **Breaking change from draft spec** — Apps using draft API must migrate
⚠️ **Adapters need transactional semantics** — Batch atomicity requires careful implementation
⚠️ **`ReadonlySet` immutability must be enforced** — Adapters must prevent direct mutation (via freeze, proxy, or wrapper)
⚠️ **Hooks fire after mutation** — If hook throws, state is already changed (no automatic rollback). Exceptions propagate to caller; apps requiring rollback must implement try/catch at handler/middleware level.
⚠️ **No `subscriberCount()` API** — Unreliable across adapters; `publish()` result provides capability hint instead

## Alternatives Considered

### 1. Flat Methods: `ctx.subscribe()`, `ctx.unsubscribe()` (DEPRECATED)

No namespace, just add methods to context directly.

**Pros:**

- Simpler initial API
- Fewer characters to type

**Cons:**

- Pollutes `ctx.*` namespace (no room for future state like presence, session info)
- No conceptual separation between messaging and subscriptions
- Harder to discover all subscription operations (scattered in context)

**Why rejected:** Context grows unbounded; namespace separation is better architecture.

**Migration:** All flat methods have been deprecated in favor of the namespaced `ctx.topics.*` API.

---

### 2. Fluent Chains: `ctx.topics.subscribe().with(metadata).auth(fn).commit()`

Builder pattern with chaining for expressiveness.

**Pros:**

- Expressive for complex operations

**Cons:**

- Boilerplate for simple cases: `await ctx.topics.subscribe(topic).commit();`
- Unusual pattern for pub/sub (RPC uses it, but subscribe/publish are simpler)
- More surface area to test and maintain

**Why rejected:** Simple operations should be simple. Fluent chains add ceremony.

---

### 3. Heavy Router Registration: `router.topic(schema, { onSubscribe, authorize, ... })`

Like `router.on()` and `router.rpc()`, register topics at router level.

**Pros:**

- Centralized topic definitions
- Per-topic lifecycle hooks and authorization

**Cons:**

- Boilerplate for simple topics without special ACL
- Topics aren't first-class like message types (asymmetry)
- Requires pre-registration; dynamic topics less natural

**Why rejected:** Common case (simple pub/sub) shouldn't require ceremony. Hooks via middleware suffice; heavy patterns are future extension.

---

### 4. Boolean Returns: `Promise<boolean>` (State Changed?)

Subscribe/unsubscribe return `boolean` indicating if state actually changed.

**Pros:**

- Can distinguish duplicate subscribe from first-time

**Cons:**

- **Anti-idiomatic** — Idempotent operations returning false create ambiguity
- Apps don't typically care about "did state change?"; they care about "is it now subscribed?"
- Invites incorrect patterns: `if (await subscribe()) { /* ... */ }` — unclear intent
- Conflicts with throw semantics (error still thrown, but what about duplicate unsubscribe?)

**Why rejected:** `Promise<void>` + throw is the idiomatic pattern in modern JavaScript.

---

### 5. Custom Subscriptions Interface

```typescript
interface Subscriptions {
  list(): readonly string[];
  has(topic: string): boolean;
}
```

Define a custom interface instead of using native `Set`.

**Pros:**

- Shields implementation details
- Could add custom methods later

**Cons:**

- Users learn a one-off interface (not discoverable from `ReadonlySet`)
- `ReadonlySet` is already immutable; custom wrapper adds confusion
- No better than native, just more layers

**Why rejected:** Use native APIs when they fit. `ReadonlySet` is perfect for subscriptions.

---

### 6. Include `subscriberCount()` API

```typescript
router.pubsub.subscriberCount(topic): number | undefined;
```

Expose subscriber count for analytics/decisions.

**Pros:**

- Useful for some applications (load balancing, visibility)

**Cons:**

- **Unreliable across adapters** — Exact on Bun, estimate on Node/uWS, unavailable on others
- Apps shouldn't rely on approximate numbers for correctness
- Spec says "don't rely on this in portable code" — then why expose it?
- `publish()` result already provides capability hint (`exact/estimate/unknown`) and matched count (if available)

**Why rejected:** Avoid APIs that are unreliable across platforms. `publish()` result is sufficient signal.

---

### 7. Mandatory Typed Topics

All topics must be defined with schema before use.

**Pros:**

- Full type safety across application

**Cons:**

- Boilerplate for simple, ephemeral topics
- Higher barrier to entry for new projects
- Doesn't match reality: some topics are dynamically constructed at runtime

**Why rejected:** Progressive type safety wins. Simple apps use strings; complex apps use `topic()` helper. Migration path is smooth.

---

### 8. Keep Separate Pub/Sub Namespace: `ctx.pubsub.publish()`

Keep all pub/sub operations (subscribe, publish) in one namespace.

**Pros:**

- Everything related to pub/sub in one place

**Cons:**

- **Conflates state mutation with transient action** — Publish is not a state change; it's a broadcast
- Suggests `publish()` is "just another subscription operation" (it's not)
- Hard to reason about semantics (is this changing state or sending a message?)

**Why rejected:** Asymmetry is intentional. Subscribe = state, Publish = action. Separating them clarifies intent.

---

### 9. Non-Atomic Batches (Partial Success Allowed)

`subscribeMany([a, b, c])` succeeds on [a, b], fails on c, returns partial result.

**Pros:**

- "Best effort" semantics
- Flexibility for apps that want partial results

**Cons:**

- **Inconsistent state** — app now subscribed to some topics, failed on others; unclear how to handle
- Error handling complex: "Did it fail on one topic or all?"
- Partial success invites bugs (app thinks it's subscribed to [a,b,c], but only [a,b] succeeded)

**Why rejected:** Atomic all-or-nothing prevents bugs. Apps can loop individual ops if they need partial tolerance.

---

### 10. Error Result: Switch on `error` Code vs Direct `retryable` Hint

How to signal retry logic in `PublishResult`?

**Alternative A: Switch on error code (rejected)**

```typescript
const result = await ctx.publish(topic, schema, data);
if (!result.ok) {
  switch (result.error) {
    case "VALIDATION":
    case "ACL":
    case "PAYLOAD_TOO_LARGE":
    case "UNSUPPORTED":
    case "STATE":
      // Don't retry
      logger.error("Publish failed", result);
      break;
    case "BACKPRESSURE":
    case "CONNECTION_CLOSED":
    case "ADAPTER_ERROR":
      // Retry with backoff
      scheduleRetry(topic, data);
      break;
  }
}
```

**Cons of switch approach:**

- Boilerplate: every publish call needs this logic (or a wrapper)
- Error-prone: forgetting a case means wrong retry behavior
- Hard to maintain: adding new errors requires hunting down all switch statements
- Doesn't scale: different apps may have different retry policies for same error

**Selected: Direct `retryable: boolean` hint**

```typescript
const result = await ctx.publish(topic, schema, data);
if (result.ok) {
  // Success
} else if (result.retryable) {
  scheduleRetry(topic, data, exponentialBackoff());
} else {
  logger.error(`Publish failed: ${result.error}`, result.details);
}
```

**Pros:**

- Zero boilerplate: two-way split is universal (retry vs fail-fast)
- Self-documenting: `retryable` directly answers "should I retry?"
- Scales: adapter sets retryability based on error semantics; app doesn't need to know error codes
- Composable: retry logic is orthogonal to error details (which live in `details` object)
- Portable: two-way split works across all adapters; switch logic would be adapter-specific

**Trade-off:**

- Apps lose fine-grained per-error-code control
- **Mitigation**: Apps that need custom logic per error can still inspect `result.error` and `result.details`; `retryable` is just a helpful default

**Why selected:** Progressive disclosure. Common case (retry vs fail-fast) is trivial; uncommon case (custom per-error logic) still available via error code inspection.

## Implementation Invariants for Adapters

These must hold for all adapters:

1. **Normalize before authorization** — App receives normalized topic in auth hooks; prevents TOCTOU
2. **Idempotency check before hooks** — Hooks only fire on state changes, not on duplicate calls
3. **Batch atomicity** — Validate all before mutating any state
4. **ReadonlySet immutability** — Prevent direct mutation via `.add()`, `.delete()`, etc.
5. **Hooks after mutation** — Hooks run only after state successfully changes
6. **Error codes** — Use `PubSubError` with correct code; never other error types
7. **Hook timing** — `onSubscribe` after subscribe, `onUnsubscribe` after unsubscribe; not called on idempotent no-ops

See [docs/specs/pubsub.md section 11](../specs/pubsub.md#11-implementation-invariants-for-adapter-authors) (Implementation Invariants for Adapter Authors) for detailed prescriptions.

## References

- **Spec** (Normative & Canonical): [`docs/specs/pubsub.md`](../specs/pubsub.md)
  - **Sections 1-10**: API surface, terminology, semantics, examples, invariants
  - **Section 11**: Implementation invariants for adapter authors (authoritative)
  - **Sections 12-15**: Adapter compliance checklist, concurrency model, edge cases

- **This ADR** (Design Rationale):
  - **Decision**: Eight core decisions and their rationale
  - **Consequences**: Benefits and trade-offs
  - **Alternatives Considered**: Why we rejected other approaches
  - **Implementation Invariants**: Design principles behind the spec

- **Related ADRs** (API Design Philosophy):
  - ADR-020: Send vs Publish (unicast vs multicast naming rationale)
  - ADR-015: Reply vs Send (RPC terminal response vs fire-and-forget)
  - ADR-014: Client-Side Request/Response (RPC auto-correlation)

- **Implementation** (Upcoming):
  - `packages/core/src/types.ts` — Context and Router interface extensions
  - `packages/core/src/adapters/` — Adapter implementations (Bun, uWS, etc.)
  - `packages/core/test/features/` — Feature tests for pub/sub semantics

---

## Appendix A: Design Trade-off Matrix

This table summarizes all major decisions and their trade-offs:

| Decision                                    | Alternative                          | Cost of Chosen                                                      | Cost of Alternative                                  | Winner           |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------- | ---------------- |
| **Namespace** `ctx.topics`                  | Flat `ctx.subscribe()`               | Context conceptually grouped                                        | Namespace clutter                                    | Namespace        |
| **State** `ReadonlySet<string>`             | Custom `subscriptions { list, has }` | Immutability enforcement needed                                     | User learns one-off interface                        | ReadonlySet      |
| **Return** `Promise<void>`                  | `Promise<boolean>`                   | No state-change signal                                              | Idiomatic ambiguity (false = error?)                 | void             |
| **Publish** Flat `ctx.publish()`            | Under `ctx.topics.publish()`         | Asymmetry not obvious                                               | Conflates state + action                             | Flat             |
| **Batch** Atomic                            | Non-atomic (partial)                 | All-or-nothing contract                                             | Apps need partial-tolerance code                     | Atomic           |
| **Typed** Optional via `topic()`            | Mandatory schema                     | Extra boilerplate on simple apps                                    | Less safety on simple cases                          | Optional         |
| **Hooks** Lightweight                       | Heavy (like `.on()` / `.rpc()`)      | Not first-class topics in router                                    | Boilerplate for simple auth                          | Lightweight      |
| **Error Retry Signal** `retryable: boolean` | Switch on error codes                | Less fine-grained control; need custom logic for per-error policies | Every app needs switch boilerplate; hard to maintain | `retryable` hint |

---

## Appendix B: Why NOT Inline Authorization in Methods

An earlier proposal was to pass authorization inline:

```typescript
// ❌ Rejected: Inline authorization
await ctx.topics.subscribe(topic, { authorize: (ctx) => canAccess(ctx) });
```

**Why this doesn't work:**

1. **Authorization is global policy** — Same check should apply to all operations, not per-call
2. **Hooks are cleaner** — `usePubSub({ authorizeSubscribe: ... })` is DRY
3. **Precedent** — Handler routing doesn't take inline authorization; middleware applies it globally
4. **Scope creep** — Soon you want inline lifecycle hooks, normalization, validation—becomes heavy fast

---

## Appendix C: Reconnection & State Persistence

**Question:** Should subscriptions persist across reconnection?

**Answer:** No. Subscriptions are per-connection state.

**Rationale:**

- WebSocket connections are stateless from protocol perspective
- Subscriptions should explicitly be re-requested on reconnection
- Apps that want to restore state should maintain their own "desired topics" list and re-subscribe

**Pattern:**

```typescript
const desiredTopics = ["room:123", "system:announcements"];

client.on("open", async () => {
  for (const topic of desiredTopics) {
    await client.subscribe(topic);
  }
});

client.on("join-room", ({ roomId }) => {
  desiredTopics.push(`room:${roomId}`);
  client.subscribe(`room:${roomId}`);
});
```

This is explicit and controllable by the app.
