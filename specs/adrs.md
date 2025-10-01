# Architectural Decision Records

## ADR-001: MessageContext Conditional Payload Typing

**Status**: Implemented

### Decision

Use explicit `keyof` check to conditionally add `payload` to `MessageContext`:

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

- Prevents `ctx.payload` access on messages without payload
- Checks key existence, not structural compatibility
- Applied to both Zod and Valibot adapters

### Implementation: Type Override for IDE Inference

**Problem**: Base router uses generic types, so TypeScript resolves `ctx.payload` as `any` in inline handlers.

**Solution**: Override `onMessage` in derived classes with validator-specific types:

```typescript
// zod/router.ts
// @ts-expect-error - Intentional override with more specific types for better DX
onMessage<Schema extends ZodMessageSchemaType>(
  schema: Schema,
  handler: ZodMessageHandler<Schema, WebSocketData<T>>,
): this {
  return super.onMessage(schema as any, handler as any);
}
```

**Trade-off**: This creates an LSP violation—derived routers are more restrictive than base. Consequence:

```typescript
// addRoutes requires | any to accept derived router instances
addRoutes(router: WebSocketRouter<T> | any): this
```

Accepts weaker typing in route composition for excellent IDE experience in primary use case (handler registration).

### Constraints for AI Code Generation

1. **NEVER** access `ctx.payload` unless schema explicitly defines payload
2. **ALWAYS** use `ctx.type` for message type
3. Test inline handler inference with `expectTypeOf`
