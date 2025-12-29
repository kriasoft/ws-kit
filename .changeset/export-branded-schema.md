---
"@ws-kit/zod": patch
"@ws-kit/valibot": patch
---

fix: export BrandedSchema type for declaration emit compatibility

Export `BrandedSchema` from the public API to fix TypeScript error TS2742 when consuming packages emit declaration files. Previously, packages using `message()` or `rpc()` with `declaration: true` would fail with:

```
The inferred type of 'X' cannot be named without a reference to
'@ws-kit/zod/dist/types'. This is likely not portable.
```

This enables the clean, idiomatic syntax without workarounds:

```typescript
// Now works with declaration emit
export const Ping = message("PING", { timestamp: z.number().optional() });
export const GetUser = rpc("GET_USER", { id: z.string() }, "USER", { ... });
```
