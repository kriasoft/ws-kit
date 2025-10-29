# ADR-004: Typed Router Factory Pattern

## Metadata

- **Date**: 2025-10-29
- **Status**: Accepted
- **Tags**: architecture, type-safety, developer-experience, API design

## Context

The `WebSocketRouter` core implementation is validator-agnostic by design—it accepts a `ValidatorAdapter` and works with Zod, Valibot, or custom validators. This flexibility comes at a type safety cost.

### The Type Erasure Problem

When handlers are registered with `router.onMessage(schema, handler)`, the router stores them in a `Map<string, MessageHandlerEntry>`:

```typescript
this.messageHandlers.set(messageType, {
  schema,
  handler: handler as MessageHandler<MessageSchemaType, TData>, // Type erased here
});
```

TypeScript cannot track the specific schema type through Map storage due to:

1. **Generic erasure**: The core router uses `MessageSchemaType = any` for validator agnosticism
2. **Map constraints**: A `Map<K, V>` cannot preserve individual value types
3. **Handler type loss**: Stored handlers resolve to the generic `MessageContext<TData>`, losing payload type information

This forces developers to use type assertions when accessing payloads:

```typescript
router.onMessage(PingMessage, (ctx) => {
  // Without factory pattern:
  const { text } = ctx.payload as any; // ← Type assertion required

  // With factory pattern (createZodRouter):
  const { text } = ctx.payload; // ← Full type inference, no assertion
});
```

See ADR-001 for the conditional payload typing strategy that reduces this burden, but it cannot completely eliminate it when using the core `WebSocketRouter` directly.

### Why This Matters

Developers expect type inference to work naturally when using TypeScript. The gap between schema definition and handler implementation creates friction:

- Examples require `as any` casts, signaling that type safety is compromised
- Developers unfamiliar with generic type limitations may suspect a library deficiency
- Runtime errors can occur if schema and handler types diverge

## Decision

Provide **factory functions** (`createZodRouter`, `createValibotRouter`) that wrap the core router and preserve type information through overloaded method signatures. This approach:

1. **Preserves types** through a thin wrapper facade
2. **Maintains API compatibility** with the core router
3. **Introduces no runtime overhead**
4. **Enables gradual migration** (opt-in, non-breaking)

### Implementation Pattern

```typescript
// packages/zod/src/router.ts
export function createZodRouter<TData extends WebSocketData = WebSocketData>(
  options?: Omit<WebSocketRouterOptions<TData>, "validator">,
): TypedZodRouter<TData> {
  const core = new WebSocketRouter<TData>({
    ...options,
    validator: zodValidator(),
  });

  const typed: TypedZodRouter<TData> = {
    onMessage(schema, handler) {
      // Type information preserved in wrapper's overloaded signature
      core.onMessage(schema, handler as any); // Safe type cast internally
      return typed;
    },
    // ... other methods (onOpen, onClose, etc.) proxy to core
    _core: core, // Advanced: access core router if needed
  };

  return typed;
}
```

The wrapper's `onMessage` method is overloaded based on the schema:

```typescript
// Wrapper signature - preserves payload type
onMessage<P extends Record<string, ZodTypeAny>>(
  schema: MessageSchema<'TYPE_A', P>,
  handler: (ctx: MessageContext<{ type: 'TYPE_A'; payload: z.infer<ZodObject<P>> }, TData>) => void
): TypedZodRouter<TData>;
```

This allows TypeScript to infer `ctx.payload` type correctly, even though the underlying core router uses generics.

### Validation-Specific Routers

Each validator adapter gets its own factory and typed wrapper:

- `@ws-kit/zod`: `createZodRouter()` → `TypedZodRouter<TData>`
- `@ws-kit/valibot`: `createValibotRouter()` → `TypedValibotRouter<TData>`

Both provide identical developer experience, just with validator-specific types.

## Alternatives Considered

### 1. Enhance Core Router with Advanced Conditional Types

**Idea**: Use TypeScript's conditional types to preserve schema types in the core router without wrapper.

**Why rejected**:

- Conditional type inference breaks when storing handlers in `Map<K, V>`
- Router composition (via `addRoutes`) requires `MessageSchemaType | any` union, undermining type safety
- Adds significant complexity to core types for theoretical benefit
- Doesn't solve the erasure problem, just makes it harder to debug

### 2. Separate Validator-Specific Router Classes

**Idea**: Create `ZodRouter` and `ValibotRouter` classes that inherit from core router.

**Why rejected**:

- Code duplication across validators
- More complex maintenance (changes to core router require syncing across subclasses)
- Inheritance over composition violates the library's composition principle
- No better type safety than the factory wrapper approach

### 3. Generic Type Parameters on Message Map

**Idea**: Use a registry pattern like `Map<string, { schema, handler, types }>` to preserve type metadata.

**Why rejected**:

- Runtime overhead (metadata lookups)
- Doesn't solve TypeScript's structural typing constraints
- More complex and fragile than wrapper approach
- Still requires internal type assertions

## Consequences

### Benefits

✅ **Perfect type inference** - No `as any` assertions needed in handlers
✅ **Zero runtime overhead** - Wrapper is a thin facade, no logic duplication
✅ **Backward compatible** - Core `WebSocketRouter` still works as before
✅ **Opt-in pattern** - Developers choose to upgrade, no forced migration
✅ **Composable** - Router composition works with typed routers

### Trade-offs

⚠️ **Two patterns exist** - Developers may be confused by `WebSocketRouter` vs `createZodRouter`
⚠️ **Documentation needed** - Must clearly explain when to use each approach
⚠️ **Type test coverage** - Requires comprehensive tests to validate type inference

### Migration Path

**For existing code**:

- No changes required, core router continues to work
- Developers can migrate incrementally: change `new WebSocketRouter()` to `createZodRouter()`

**For new code**:

- Use `createZodRouter()` or `createValibotRouter()` directly for full type safety

**Example migration** (zero breaking changes):

```typescript
// Before - still works forever
const router = new WebSocketRouter({
  validator: zodValidator(),
});

// After - recommended for new code
const router = createZodRouter();
```

## References

- **ADR-001**: MessageContext Conditional Payload Typing - Documents the payload type inference strategy that reduces but doesn't eliminate the need for this pattern
- **Implementation**:
  - `packages/zod/src/router.ts:59-116` - Zod typed router factory
  - `packages/valibot/src/router.ts:59-116` - Valibot typed router factory
  - `packages/zod/src/index.ts` - Factory export
  - `packages/valibot/src/index.ts` - Factory export
- **Type Tests**:
  - `packages/zod/test/types/router-inference.test.ts:1-415` - Comprehensive inference test coverage
  - `packages/valibot/test/types/router-inference.test.ts` - Mirror tests for Valibot
- **Related**: CLAUDE.md - Quick Start Guide (should reference typed routers)
