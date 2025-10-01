# Architectural Decision Records

## ADR-001: MessageContext Conditional Payload Typing

**Status**: Implemented
**Date**: 2025-10-01

### Problem

`MessageContext<Schema, Data>` incorrectly included `payload` property for ALL schemas, even those without payload. TypeScript failed to catch `ctx.payload` access in handlers for payload-less messages.

### Decision

Use explicit `keyof` check instead of structural `extends`:

```typescript
export type MessageContext<Schema extends MessageSchemaType, Data> = {
  ws: ServerWebSocket<Data>;
  type: Schema["shape"]["type"]["value"];
  meta: z.infer<Schema["shape"]["meta"]>;
  send: SendFunction;
} & ("payload" extends keyof Schema["shape"]
  ? Schema["shape"]["payload"] extends ZodType
    ? { payload: z.infer<Schema["shape"]["payload"]> }
    : Record<string, never>
  : Record<string, never>);
```

### Rationale

- Checks key existence, not structural compatibility
- Avoids TypeScript's structural typing matching optional properties
- More explicit and maintainable
- Applied to both Zod and Valibot adapters

### Constraints for AI Code Generation

When generating message handler code:

1. **NEVER** access `ctx.payload` unless schema explicitly defines payload
2. **ALWAYS** use `ctx.type` for message type (added alongside this fix)
3. Rely on TypeScript errors for payload access validation
4. Add type-level tests using `expectTypeOf` for new message schemas
