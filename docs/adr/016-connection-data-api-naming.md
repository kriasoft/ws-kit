# ADR-016: Connection Data API Naming

## Problem

Router needs a method name for partial connection data updates in handlers and middleware. Which name best communicates intent to developers?

## Options

### ✅ `assignData()` — RECOMMENDED

**Reasoning:**

- Aligns with `Object.assign()` — standard JavaScript pattern all developers know
- Implementation uses `Object.assign(ctx.ws.data, partial)` internally, so name matches reality
- No semantic confusion with HTTP PATCH (RFC 6902 uses operations array, not simple object merge)
- Clearly indicates partial updates are supported (unlike "set" which implies full replacement)
- Natural fit with TypeScript's `Partial<T>` type signature

**Consequences:**

- Slightly longer (10 chars vs alternatives)
- Familiar to JS/TS developers
- Zero confusion with HTTP semantics

---

### `patchData()`

**Reasoning against:**

- HTTP PATCH has specific semantics (RFC 6902 JSON Patch format) — developers familiar with REST APIs expect `[{op: "add", path: "/userId", value: "123"}]`
- Creates false expectations about API behavior
- No standard JavaScript equivalent (`Object.patch()` doesn't exist)
- Trendy but imprecise for this use case

---

### `updateData()`

**Reasoning against:**

- Too generic — doesn't indicate partial vs full replacement
- Unclear what update strategy is used
- Developers might assume full object replacement

---

### `mergeData()`

**Reasoning against:**

- Non-standard in JavaScript (the convention is `Object.assign`, not `Object.merge`)
- Could imply deep merge (we only do shallow)
- Less discoverable

---

### `setData()`

**Reasoning against:**

- Implies full replacement (like `Map.set()`)
- Doesn't communicate partial update support
- Creates confusion about merge vs replace semantics

## Status

Implemented as `ctx.assignData()` throughout codebase. Library not yet published, so this is final.

## References

- Implementation: `packages/core/src/types.ts:118-134`
- Spec: `docs/specs/router.md`
- Related: ADR-007 (naming principles), ADR-014 (API naming for RPC methods)
