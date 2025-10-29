# ADR-003: Example Import Strategy with Path Aliases

**Status**: ✅ Implemented

## Context

Examples need a clear, production-like import pattern that works seamlessly in development while remaining valid after package publishing. The key tension: examples run in a monorepo workspace, but should look like they're using published packages.

## Decision

Use **TypeScript path aliases + Bun path mappings** to resolve `@ws-kit/*` imports to source files in development. This provides:

1. **Unified import pattern**: Examples use production-like imports that work before and after publishing
2. **Full IDE support**: TypeScript path aliases enable code completion, type checking, go-to-definition
3. **Zero build overhead**: Pure development tooling (no runtime artifacts)
4. **Monorepo standard**: Follows TypeScript ecosystem best practices

## Implementation

### TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@ws-kit/*": ["packages/*/src"]
    }
  }
}
```

### Bun Configuration (`bunfig.toml`)

```toml
[paths]
"@ws-kit/*" = "packages/*/src"
```

### Example Usage

```typescript
// examples/quick-start/index.ts
import { z, message, createRouter } from "@ws-kit/zod";
import { wsClient } from "@ws-kit/client/zod";
import { serve } from "@ws-kit/serve/bun";

// All imports resolve to source files via path aliases
// Same imports work after packages are published to npm
```

## How It Works

**In development**:

- TypeScript resolves `@ws-kit/zod` → `packages/zod/src` (via `tsconfig.json`)
- Bun resolves `@ws-kit/zod` → `packages/zod/src` (via `bunfig.toml`)
- IDE provides full type inference and navigation

**After publishing**:

- npm resolves `@ws-kit/zod` → installed package from registry
- No code changes needed (imports stay the same)
- package.json dependency declarations handle the mapping

## Alternatives Considered

| Option                                    | Pros                                            | Cons                                           | Decision      |
| ----------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ------------- |
| Relative imports `../../packages/zod/src` | Works immediately                               | Doesn't match production, fragile paths        | ❌ Rejected   |
| Status quo (Bun workspace only)           | Works without config                            | Requires workspace knowledge, poor IDE support | ❌ Rejected   |
| **Path aliases**                          | IDE support, production-like, monorepo standard | Requires config files                          | ✅ **Chosen** |
| Dual examples (dev + prod versions)       | Clear distinction                               | Code duplication, maintenance burden           | ❌ Rejected   |

## Trade-offs

- **Configuration burden**: Requires both `tsconfig.json` and `bunfig.toml` setup
- **TypeScript-only benefit**: IDE support works via TypeScript, Bun gets fallback resolution
- **Path alias maintenance**: If package structure changes, must update path patterns (unlikely)

## Constraints for Contributors

1. **ALWAYS** use `@ws-kit/*` imports in examples (never relative paths)
2. **NEVER** use `/src` or `/index.js` suffixes on package imports
3. **Keep examples production-ready**: They should work unchanged after publishing
4. **Test examples with type checking**: Run `bun run test:types` to verify path resolution

## Benefits

- ✅ Examples look like production code users will write
- ✅ Full IDE code completion and type checking
- ✅ Follows TypeScript monorepo best practices
- ✅ No special build or runtime setup needed
- ✅ Works with both TypeScript and JavaScript projects

## References

- `tsconfig.json` - TypeScript path configuration
- `bunfig.toml` - Bun runtime path configuration
- `examples/README.md` - User guide for running examples
