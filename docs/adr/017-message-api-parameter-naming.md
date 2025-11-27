# ADR-017: Message API Parameter Naming

**Status**: Implemented
**Date**: 2025-10-30
**References**: ADR-007, ADR-015, docs/specs/schema.md

## Context

Three parameter names in the unified message API significantly impact clarity:

- `payload` — Message data
- `response` — RPC terminal result schema
- `meta` — Metadata (timestamp, correlation ID, etc.)

These names affect both definition and handler access:

```typescript
const GetUser = message("GET_USER", {
  payload: { id: z.string() },
  response: { user: UserSchema },
  meta: { roomId: z.string() },
});

router.on(GetUser, (ctx) => {
  ctx.payload.id;      // Message payload
  ctx.reply?.(...);    // Terminal reply
  ctx.meta.roomId;     // Message metadata
});
```

## Decision

### `payload` — Message Data

**Chosen**: `payload`

| Rationale            | Details                                               |
| -------------------- | ----------------------------------------------------- |
| WebSocket convention | Industry standard: socket.io, Centrifuge, ActionCable |
| Message semantics    | "Payload" = the cargo being transported               |
| Pattern-neutral      | Works for pub/sub and RPC equally                     |
| JS precedent         | Node.js EventEmitter, DOM CustomEvent                 |

**Rejected alternatives**: `request` (RPC-only), `data` (too vague), `body` (HTTP-specific), `input` (functional jargon), `params` (REST-specific)

---

### `response` — RPC Terminal Result

**Chosen**: `response`

| Rationale       | Details                                     |
| --------------- | ------------------------------------------- |
| RPC standard    | gRPC, Twirp, REST all use "response"        |
| Intent signal   | Presence of `response` marks message as RPC |
| Handler clarity | Pairs naturally with `ctx.reply()`          |
| Bidirectional   | `payload` (request) ↔ `response` (result)   |

**Rejected alternatives**: `result` (ambiguous with progress), `reply` (awkward in schema), `terminal` (non-standard), `output` (functional term), `success` (doesn't cover errors)

---

### `meta` — Message Metadata

**Chosen**: `meta`

| Rationale         | Details                                   |
| ----------------- | ----------------------------------------- |
| Web standard      | Express, GraphQL, JSON:API all use "meta" |
| Safe naming       | Less conflict-prone than "data"           |
| WebSocket neutral | Doesn't imply HTTP headers or RPC         |
| IDE friendly      | Single syllable; easy to autocomplete     |

**Rejected alternatives**: `metadata` (too verbose), `headers` (HTTP-specific), `context` (overloaded), `attributes` (verbose), `tags` (wrong semantics)

---

### Config Object Pattern

**Chosen**: `message(type, { payload?, response?, meta? })`

- **Forward extensible** — New fields without breaking overloads
- **Self-documenting** — IDE shows all options; no argument order to remember
- **Backward compatible** — Legacy positional API still works
- **Type safe** — Precise overloads enable conditional types

**Examples:**

```typescript
// Pub/sub
const Broadcast = message("BROADCAST", { payload: { text: z.string() } });

// RPC with payload
const Query = message("QUERY", {
  payload: { id: z.string() },
  response: { data: z.any() },
});

// RPC without payload
const Ping = message("PING", { response: { ack: z.boolean() } });
```

**Type safety benefits:**

- `ctx.payload` only exists if schema defines it
- `ctx.reply()` only exists for RPC messages
- `ctx.progress()` only exists for RPC messages

---

## Consequences

✅ Familiar terminology — Recognizable across frameworks
✅ Intent signaling — `response` field clearly marks RPC
✅ Type safety — Conditional types prevent mistakes
✅ Extensible — New fields don't require new signatures

⚠️ Three names to remember (but they're standard across industry)

## Implementation

**Status**: ✅ Implemented across both validators

- `packages/zod/src/schema.ts` — Config object overloads
- `packages/valibot/src/schema.ts` — Mirror implementation
- `packages/core/src/types.ts` — Handler context types

## References

- **ADR-007**: Naming principles
- **ADR-015**: Unified RPC API design (config object pattern)
- **docs/specs/schema.md**: Usage examples
