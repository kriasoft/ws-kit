# ADR-023: Schema-Driven Type Inference for Message Handlers

**Status**: Accepted
**Date**: 2025-11-10
**Tags**: type-system, api-design, inference

## Context

When passing a router through function parameters (e.g., `setupChat(router: Router<AppData>)`), type information about message payloads was lost. Developers had to manually annotate handler contexts to regain type safety:

```typescript
// Problem: c.payload has no type information
router.on(JoinRoom, (c) => {
  const { roomId } = c.payload; // ❌ any, not string
});

// Workaround: Manual annotation
router.on(JoinRoom, (c: MessageContext<typeof JoinRoom, AppData>) => {
  const { roomId } = c.payload; // ✅ string, but verbose
});
```

## Root Cause

The `Router<TData>` type defines `on()` as:

```typescript
on<TSchema extends MessageSchemaType>(
  schema: TSchema,
  handler: MessageHandler<TSchema, TData>
): this;
```

But when TypeScript **erases** the router into the interface type (losing the validator family info), `MessageHandler<TSchema, TData>` can't infer the context because the validator metadata is attached to the schema at creation time (via `@ws-kit/zod` or `@ws-kit/valibot`).

## Decision

**Schema-driven inference**: The handler context is inferred **purely from the schema parameter**, not from router state. This requires no router generics, works with any validator, and restores inference immediately.

The signature remains the same, but TypeScript's inference is now powerful enough to extract payload types directly from Zod/Valibot schemas without router context:

```typescript
// Works perfectly—no annotation needed
router.on(JoinRoom, (c) => {
  const { roomId } = c.payload; // ✅ string (inferred from schema)
  c.payload.unknown; // ❌ TypeScript error (property doesn't exist)
});
```

### Why This Works

Both Zod and Valibot brands schemas with **metadata that encodes the payload shape**. The `MessageSchemaType` union is broad enough to cover both families. TypeScript's conditional types extract the payload type from any schema without needing router state.

**Key insight**: Validators already provide `infer<T>(schema: T): any` in `ValidatorAdapter`. We use this same mechanism at the type level to preserve the schema → payload relationship.

## Consequences

### Benefits

✅ **Perfect inference everywhere** — Helpers, routers, middleware all get typed payloads without extra generics or assertions
✅ **No manual annotations** — Developers never write `(c: MessageContext<typeof Schema, AppData>)`
✅ **Validator-agnostic** — Works with Zod, Valibot, or any future validator
✅ **Composable** — Functions accepting `Router<TData>` automatically support typed messages
✅ **Progressive** — No changes to public API; existing code continues to work

### Trade-offs

⚠️ **No family enforcement** — Router can't prevent mixing Zod and Valibot schemas (though runtime validation will catch mismatches)
⚠️ **Requires schema quality** — If schema metadata is incorrect, inference breaks

**Mitigation**: Validators are part of the library; both Zod and Valibot have strong test coverage. Apps that need strict family enforcement can use narrower helpers (see below).

## Optional: Narrower Helpers for Pros

For applications that want explicit validator family verification, export lightweight narrowers:

```typescript
import { asZodRouter } from "@ws-kit/zod";

export function setupChat(router: Router<AppData>) {
  const zodRouter = asZodRouter(router); // Type-safe cast
  zodRouter.on(JoinRoom, (c) => {
    // Full inference, guaranteed Zod family
  });
}
```

**Design**: These helpers are optional. They provide `(router as Router<TData> & { validator: ZodAdapter })` for advanced use cases (e.g., multi-validator apps requiring per-module consistency).

**Implementation**: Add to `@ws-kit/zod` and `@ws-kit/valibot` as lightweight type helpers. Zero runtime overhead (no-op type casts with optional assertions).

## Alternatives Considered

### A. Router-Level Validator Generic

```typescript
interface Router<TData, V extends ValidatorAdapter> {
  on<S extends MessageSchemaType>(schema: S, handler: ...): this;
}
```

**Pros**: Strict family enforcement at type level
**Cons**: Extra generic on widely-used interface; most users don't need this
**Verdict**: Rejected (over-engineering for common case)

### B. Explicit Handler Annotation (Status Quo)

```typescript
router.on(JoinRoom, (c: MessageContext<typeof JoinRoom, AppData>) => { ... });
```

**Pros**: Works today, explicit intent
**Cons**: Boilerplate, error-prone, violates DRY
**Verdict**: Rejected (this is the problem we're solving)

### C. Mandatory Narrower Helpers (Required, not Optional)

```typescript
// Every user must explicitly narrow
const zodRouter = asZodRouter(router);
zodRouter.on(JoinRoom, (c) => {
  /* typed */
});
```

**Pros**: Forces explicit validator family declaration
**Cons**: Extra ceremony for every feature; most apps only use one validator family anyway
**Verdict**: Rejected (optional narrowers strike better balance)

### D. Runtime Validator Family Lock

```typescript
// Router enforces family at init time
const router = createRouter<AppData>({
  validator: zodValidator(),
  strictFamily: true, // Throws if schema from different family
});
```

**Pros**: Prevents accidental validator mixing at runtime
**Cons**: Adds runtime overhead and complexity; schema metadata checks aren't free
**Verdict**: Rejected (type system + optional narrowers sufficient; families are per-module in practice)

## References

### Guides & Documentation

- **[docs/guides/schema-driven-design.md](../guides/schema-driven-design.md)** — A + G + D complete guide with end-to-end examples and migration path
- **[docs/patterns/composition.md](../patterns/composition.md)** — Router composition patterns, testing, and when to use helpers vs composition
- **[docs/specs/router.md § Route Composition](../specs/router.md)** — Detailed merge() semantics and type safety

### Implementation

- `packages/core/src/core/router.ts` — `Router` type, `RouterCore` interface
- `packages/zod/src/types.ts` — Zod schema metadata and type extraction
- `packages/zod/src/validator.ts` — Validator adapter implementation
- `packages/zod/src/narrower.ts` — Optional `asZodRouter()` helper
- `docs/specs/schema.md` — Message schema canonical structure
