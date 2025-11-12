# ADR-025: Validator Plugins with Configurable Options

## Metadata

- **Date**: 2025-11-11
- **Status**: **Accepted**
- **Tags**: architecture, validation, plugins, performance, DX

## Context

Previously, validators (Zod, Valibot) were baked into the router factory and entry points, making it:

- **Tight coupling**: Core router carried validator logic, expanding its surface area
- **Inflexible**: Switching validators (Zod ↔ Valibot) required changing imports across the codebase
- **One-size-fits-all**: No fine-grained control over validation behavior (e.g., whether to validate outbound payloads)

Applications need:

1. **Optional validation**: Opt-in via plugins, not forced by default
2. **Performance tuning**: Toggle outbound validation, coerce rules, error hooks
3. **Composable capabilities**: Validators sit alongside pub/sub, rate limiting, telemetry plugins
4. **Developer ergonomics**: Clear, configurable API that mirrors Zod and Valibot

## Decision

Implement **validator plugins** (`withZod()`, `withValibot()`) with configurable options:

```typescript
const router = createRouter()
  .plugin(
    withZod({
      validateOutgoing: true, // Default: true; set false for hot paths
      coerce: false, // Zod-specific; pass to schema.parse()
      onValidationError: (err, ctx) => {
        // Custom error handling (opt-in hook)
        logger.error("Validation failed", {
          type: ctx.type,
          direction: ctx.direction,
        });
      },
    }),
  )
  .plugin(withPubSub({ adapter: redisPubSub() }))
  .on(ChatMessage, (ctx) => {
    // ctx.payload validated and typed
  });
```

### Key Features

1. **Plugin-based**: Validators are pure functions that widen router type
2. **Idempotent**: Same plugin applied twice is safely ignored
3. **Configurable**:
   - `validateOutgoing?: boolean` — Validate `ctx.send()`, `ctx.reply()`, `ctx.publish()` payloads (default: true)
   - `coerce?: boolean` — Zod-only; enable schema coercion (default: false)
   - `onValidationError?: (error, context) => void` — Custom error hook (optional; defaults to router.onError)

4. **Inbound validation**: Always validates incoming payloads (unless schema missing)
5. **Outbound validation**: Validates outbound payloads when enabled (performance knob)
6. **Error routing**: Routes validation errors to custom hook or `router.onError()`

### Mirror Pattern

`withValibot()` mirrors `withZod()` API:

- Same option shape (minus Zod-specific `coerce`)
- Same error handling semantics
- Same capability flag: `{ validation: true }`

## Alternatives Considered

1. **Baked-in validators** (status quo)
   - ✅ Simpler entry point
   - ❌ Tight coupling, hard to switch, inflexible

2. **Multiple entry points per validator**
   - ✅ Customizable at factory time
   - ❌ Verbose: `createRouter({ validator: 'zod', validateOutgoing: true })`
   - ❌ No clear capability gating at type level

3. **Lazy validation with global config**
   - ✅ Preserves single entry point
   - ❌ Config scattered, hard to track where validation happens
   - ❌ Error hooks require global registry

## Consequences

### Benefits

- **Smaller core**: Router no longer carries validator logic; stays focused on dispatch
- **Flexible composition**: Mix validators with pub/sub, rate limiting, observability plugins
- **Performance control**: Disable outbound validation for ultra-hot paths
- **Better error handling**: Custom hooks for validation errors (logging, telemetry, recovery)
- **Type safety preserved**: Plugin return type is `Router<TContext, { validation: true }>` ensuring full inference

### Risks & Mitigations

| Risk                                        | Mitigation                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Dual package hazard** (types duplication) | Keep Zod/Valibot as peerDependencies in validator plugins; never re-bundle                    |
| **Plugin order sensitivity**                | Validators are independent; `.on()` typing only requires capability flag—order stays flexible |
| **Runtime overhead**                        | Offer `validateOutgoing: false`; per-route opt-outs via middleware filters                    |
| **Migration from baked-in**                 | Provide deprecation period; short migration guide in docs; codemod if needed                  |

### Maintenance

- **Test coverage**: Both Zod and Valibot plugins mirror-tested (same test suite for adapter)
- **Docs**: Update specs with plugin configuration examples, error handling patterns
- **Examples**: Show `withZod()` / `withValibot()` usage in README and patterns

## References

- [Router Spec](../specs/router.md#plugins) — Plugin API and capability gating
- [Validation Spec](../specs/validation.md#plugins) — Validation flow with plugins
- [Error Handling](../specs/error-handling.md#validation-errors) — Validation error patterns
- Related: ADR-007 (Export-with-Helpers), ADR-023 (Schema-Driven Type Inference)
