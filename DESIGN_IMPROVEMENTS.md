# Design Improvements: Reducing Over-Engineering

**Context**: Architectural review feedback identifying opportunities to simplify the router implementation and align with design philosophy: "Maintain simplicity, avoiding unnecessary complexity."

**Current Philosophy**: Prioritize optimal design over backwards compatibility, ease of use, and performance.

---

## Issue 1: Heartbeat Always Enabled

**Current State** (`packages/core/src/router.ts:105-113`):

```typescript
// ALWAYS initialized with defaults, even if not configured
this.heartbeatConfig = {
  intervalMs:
    options.heartbeat?.intervalMs ?? DEFAULT_CONFIG.HEARTBEAT_INTERVAL_MS,
  timeoutMs:
    options.heartbeat?.timeoutMs ?? DEFAULT_CONFIG.HEARTBEAT_TIMEOUT_MS,
  onStaleConnection: options.heartbeat?.onStaleConnection,
};
```

**Problems**:

1. **Hidden state**: Heartbeat is initialized and started on every connection, even for apps that don't need it
2. **Hard to test/mock**: `heartbeatStates` Map accumulates state for every connection, making it difficult to isolate
3. **Violates "smallest API"**: Not all apps need heartbeat (short-lived connections, custom ping logic, stateless APIs)
4. **Memory overhead**: Map tracks state even when feature isn't used

**Design Principle Conflict**: "Maintain simplicity" — this adds hidden behavior and implicit state that users don't opt into.

### Recommended Solution: Make Heartbeat Opt-In

**Option A: Only Enable When Explicitly Configured** (Preferred)

```typescript
// Only initialize heartbeat config if provided by user
this.heartbeatConfig = options.heartbeat ? {
  intervalMs: options.heartbeat.intervalMs ?? DEFAULT_CONFIG.HEARTBEAT_INTERVAL_MS,
  timeoutMs: options.heartbeat.timeoutMs ?? DEFAULT_CONFIG.HEARTBEAT_TIMEOUT_MS,
  onStaleConnection: options.heartbeat.onStaleConnection,
} : undefined;

// In handleOpen()
if (this.heartbeatConfig) {  // Only initialize state if configured
  this.heartbeatStates.set(clientId, { ... });
  this.startHeartbeat(clientId, ws);
}
```

**Benefits**:

- Apps without heartbeat get zero overhead (no state, no timers)
- Explicit opt-in makes behavior transparent
- Easier to test (can verify state stays empty when not configured)
- Cleaner code path: if heartbeat not needed, entire feature is skipped

**Breaking Change**: YES, but justified:

- Apps relying on implicit heartbeat must now explicitly opt-in
- Trivial migration: `{ heartbeat: { intervalMs: 30_000, timeoutMs: 5_000 } }`
- Benefit: Apps that don't need heartbeat get cleaner, faster router

**Testing Impact**:

- Existing tests will need heartbeat config to enable heartbeat features
- Tests without heartbeat config should verify no state accumulates
- No logic change, just conditional initialization

---

## Issue 2: Validator Warnings Instead of Errors

**Current State** (`packages/core/src/router.ts:147-151, 186-191`):

```typescript
on<Schema extends MessageSchemaType>(
  schema: Schema,
  handler: MessageHandler<Schema, TData>,
): this {
  if (!this.validator) {
    console.warn("[ws] No validator configured. Messages of this type will not be routed.");
    return this;  // ❌ Silently fails to register!
  }
  // ...
}
```

**Problems**:

1. **Silent failures**: Handler is registered but never called—mismatches expectations
2. **Runtime surprises**: Bug discovered only when message arrives (or never if message type unused)
3. **Violates "type-safety"**: Core promise of ws-kit is type-safe validation—allowing unvalidated handlers contradicts this
4. **Unclear state**: Is the handler registered? Will it receive messages? Unknown without looking at logs.

**Design Principle Conflict**: "Type safety" is core to ws-kit design. Allowing unvalidated handlers violates this principle.

### Recommended Solution: Fail Fast with Clear Error

```typescript
on<Schema extends MessageSchemaType>(
  schema: Schema,
  handler: MessageHandler<Schema, TData>,
): this {
  if (!this.validator) {
    throw new Error(
      "No validator configured. Create router with validator: " +
      "createRouter({ validator: new ZodAdapter() }) or use @ws-kit/zod's createRouter()."
    );
  }

  const messageType = this.validator.getMessageType(schema);
  // ...
}
```

**Benefits**:

- Fail immediately at development time (not runtime)
- Developer sees exact issue and solution
- Impossible to register unvalidated handler
- Aligns with type-safety design principle
- Improves DX: clear error message guides user to solution

**Breaking Change**: YES, but correct:

- Old code: `router.on(schema, handler)` silently does nothing without validator
- New code: `router.on(schema, handler)` throws if no validator
- Migration: Ensure router is created with validator before calling `.on()`

**Also Apply To**:

- `.off()` (line 186)
- `.use(schema, middleware)` (line 339)
- `.send()` (line 1072)

**Rationale**: These methods require validation. If no validator exists, the state is invalid and should fail immediately.

---

## Issue 3: PubSub Always Present

**Current State** (`packages/core/src/router.ts:100-101`):

```typescript
this.pubsub = options.pubsub || options.platform?.pubsub || new MemoryPubSub();
```

**Problems**:

1. **Unnecessary overhead**: Apps without broadcasting get a PubSub instance (memory + initialization cost)
2. **Hidden dependency**: Developer doesn't realize broadcasting is available—or incur hidden cost
3. **Violates "opt-in"**: Feature is implicit, not explicit
4. **Test isolation**: Hard to verify app doesn't accidentally use pubsub (state exists even if unused)

**Design Principle Conflict**: "Maintain simplicity" — apps that don't use broadcasting shouldn't pay cost for it.

### Recommended Solution: Lazy PubSub Initialization

```typescript
// Store provided pubsub or platform pubsub, but DON'T create default
private pubsubInstance?: PubSub;

constructor(options: WebSocketRouterOptions<V, TData> = {}) {
  // Only set if explicitly provided
  if (options.pubsub || options.platform?.pubsub) {
    this.pubsubInstance = options.pubsub || options.platform.pubsub;
  }
  // If not provided, leave undefined—will be created on first use
}

// Lazy getter: create MemoryPubSub only when publish() is first called
private get pubsub(): PubSub {
  if (!this.pubsubInstance) {
    this.pubsubInstance = new MemoryPubSub();
  }
  return this.pubsubInstance;
}

// In handleMessage(), when subscribe/unsubscribe is called, pubsub getter is triggered
```

**Benefits**:

- Zero overhead for apps without broadcasting (no PubSub instance created)
- Apps that use broadcasting get automatic MemoryPubSub (works out of box)
- Apps with custom pubsub still pass it explicitly
- Lazy initialization: cost only paid when actually used
- Better for testing: can verify pubsub was never instantiated for non-broadcasting apps

**Breaking Change**: NO (purely an optimization)

- API surface unchanged
- All existing code continues to work
- Just removes hidden cost

**Testing Impact**:

- Tests can verify `pubsub` is undefined until first use
- Broadcasting tests trigger lazy initialization
- No behavior change, just initialization timing

---

## Issue 4: Reserved Keys Stripping Duplication

**Current State**:

- **Design-time check**: `validateMetaSchema()` in `normalize.ts:13-25` throws if schema defines reserved keys
- **Runtime check**: `normalizeInboundMessage()` in `normalize.ts:41-64` strips reserved keys from inbound messages

**Problems** (Minor):

1. **Duplication**: Two places check reserved keys
2. **Logic spread**: `validateMetaSchema()` is called in validator packages (Zod/Valibot), not in core
3. **Mixed concerns**: Design-time validation (schema validation) and runtime safety (message normalization)

**Current Defense-in-Depth**: Actually correct! Two layers provide defense-in-depth:

- Design-time: Catch mistakes early (developer defines reserved key in schema)
- Runtime: Catch client spoofing (client sends reserved key in message)

### Recommendation: KEEP THE DUPLICATION (No Change)

**Rationale**:

1. **Different concerns**:
   - Design-time check prevents schema bugs at development time
   - Runtime stripping is security boundary (prevents client spoofing)
2. **Separate ownership**:
   - Validator packages own schema creation (`validateMetaSchema`)
   - Core router owns message processing (`normalizeInboundMessage`)
3. **Minimal duplication**: Only 2 keys in `RESERVED_META_KEYS` set
4. **Clear intent**: Each check serves different purpose and audience

**Code is Optimal As-Is**:

- Runtime stripping is essential and not redundant
- Design-time check is validator-specific (each validator package handles its schemas)
- No false duplication—different layers, different concerns

---

## Implementation Roadmap

### Phase 1: Fail-Fast Validator (High Priority)

**Impact**: Prevents silent bugs and improves DX

- Change `.on()`, `.off()`, `.use(schema, ...)` to throw on missing validator
- Add clear error messages guiding users to solution
- Update tests to provide validator config
- Update examples in docs

### Phase 2: Opt-In Heartbeat (High Priority)

**Impact**: Reduces memory overhead, improves clarity

- Make `heartbeatConfig` optional (only init if provided)
- Only add to `heartbeatStates` when heartbeat configured
- Update test setup to explicitly enable heartbeat if needed
- Add docs explaining heartbeat is opt-in

### Phase 3: Lazy PubSub (Medium Priority)

**Impact**: Reduces overhead for non-broadcasting apps

- Implement lazy getter for `pubsub`
- No API changes, pure optimization
- Tests can verify lazy initialization
- Document behavior in pubsub specs

### Phase 4: Documentation (High Priority)

**Needed for all changes**:

- Update `CLAUDE.md` to reflect new fail-fast validator
- Update `docs/specs/` with opt-in heartbeat and lazy pubsub behavior
- Add migration guide for breaking change (validator errors)
- Add examples showing explicit opt-in patterns

---

## Breaking Changes Summary

| Issue                       | Change Type  | Migration Path                  | Effort |
| --------------------------- | ------------ | ------------------------------- | ------ |
| Validator warnings → errors | BREAKING     | Add validator to router options | 5 min  |
| Heartbeat opt-in            | BREAKING     | Add `heartbeat` config if using | 2 min  |
| PubSub lazy init            | Non-breaking | No action needed                | 0 min  |
| Reserved keys duplication   | No change    | No action needed                | 0 min  |

**Total Migration Effort**: Trivial. Most projects create router once, so changes are one-time in app setup.

---

## Design Philosophy Alignment

### Current Implementation Issues

| Principle   | Issue                        | Status              |
| ----------- | ---------------------------- | ------------------- |
| Simplicity  | Heartbeat always enabled     | ❌ Over-engineered  |
| Type Safety | Unvalidated handlers allowed | ❌ Violates promise |
| Opt-In      | PubSub always created        | ❌ Hidden cost      |
| Fail Fast   | Validator warnings           | ❌ Silent failures  |

### After Changes

| Principle   | Status                               | Benefit                    |
| ----------- | ------------------------------------ | -------------------------- |
| Simplicity  | ✅ Heartbeat opt-in, no hidden state | Cleaner mental model       |
| Type Safety | ✅ Fail if no validator              | Impossible to misconfigure |
| Opt-In      | ✅ PubSub lazy-initialized           | Zero overhead when unused  |
| Fail Fast   | ✅ Errors on misconfiguration        | Clear, immediate feedback  |

---

## Testing Strategy

After changes:

```typescript
// Test 1: Heartbeat disabled by default
test("router initializes without heartbeat state when not configured", () => {
  const router = createRouter();
  // heartbeatStates should be empty
  expect(getHeartbeatStatesCount(router)).toBe(0);
});

// Test 2: Validator required
test("router.on() throws if no validator configured", () => {
  const router = new WebSocketRouter();
  const schema = { type: "TEST" };
  expect(() => router.on(schema, () => {})).toThrow(/No validator configured/);
});

// Test 3: Lazy PubSub
test("pubsub not instantiated until first use", () => {
  const router = createRouter();
  expect(getPubSubInstance(router)).toBeUndefined();

  router.publish("test", {});
  expect(getPubSubInstance(router)).toBeInstanceOf(MemoryPubSub);
});
```

---

## Conclusion

These four improvements align ws-kit with its core design philosophy:

1. **Simplicity** → heartbeat opt-in, lazy PubSub
2. **Type Safety** → fail-fast validator
3. **Clarity** → explicit opt-in patterns
4. **Performance** → zero overhead for unused features

All changes are justified by design philosophy and provide clear benefits. The breaking changes are trivial to migrate and improve overall API clarity.
