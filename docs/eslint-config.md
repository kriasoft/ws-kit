# ESLint Configuration for Import Safety

This guide shows how to configure ESLint to prevent dual-package hazards with ws-kit validators.

## The Problem

Importing validators directly causes type mismatches:

```typescript
// ❌ BAD: Two different Zod instances
import { z } from "zod"; // Instance A
import { message } from "@ws-kit/zod"; // Uses Instance B's z
// Result: Discriminated unions break silently
```

## The Solution

Configure ESLint to forbid direct imports from `"zod"` and `"valibot"`.

**Note:** The ws-kit project currently does not enforce these restrictions in its own codebase, but we recommend adding them to application projects that use ws-kit to prevent dual-package hazards.

## Configuration

WS-Kit uses ESLint 9.x with the modern flat config format (`eslint.config.js` or `eslint.config.ts`). If you're using an older version of ESLint, see the [legacy configuration section](#legacy-configuration-eslint-8x) below.

### For Zod Users

**TypeScript (eslint.config.ts):**

```typescript
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    name: "restrict-zod-imports",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          name: "zod",
          message:
            "Import Zod from @ws-kit/zod instead to prevent dual-package hazards. " +
            "Use: import { z, message, createRouter } from '@ws-kit/zod'",
        },
      ],
    },
  },
]);
```

**JavaScript (eslint.config.js):**

```javascript
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    name: "restrict-zod-imports",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          name: "zod",
          message:
            "Import Zod from @ws-kit/zod instead to prevent dual-package hazards. " +
            "Use: import { z, message, createRouter } from '@ws-kit/zod'",
        },
      ],
    },
  },
]);
```

### For Valibot Users

**TypeScript (eslint.config.ts):**

```typescript
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    name: "restrict-valibot-imports",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          name: "valibot",
          message:
            "Import Valibot from @ws-kit/valibot instead to prevent dual-package hazards. " +
            "Use: import { v, message, createRouter } from '@ws-kit/valibot'",
        },
      ],
    },
  },
]);
```

### For Both Validators

If your project might use both (e.g., server + client):

**TypeScript (eslint.config.ts):**

```typescript
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    name: "restrict-validator-imports",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          name: "zod",
          message:
            "Import Zod from @ws-kit/zod instead. " +
            "Use: import { z, message, createRouter } from '@ws-kit/zod'",
        },
        {
          name: "valibot",
          message:
            "Import Valibot from @ws-kit/valibot instead. " +
            "Use: import { v, message, createRouter } from '@ws-kit/valibot'",
        },
      ],
    },
  },
]);
```

## Allow Exceptions

To allow direct imports in specific files (e.g., test files or utilities):

**TypeScript (eslint.config.ts):**

```typescript
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    name: "restrict-validator-imports",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          name: "zod",
          message: "Import from @ws-kit/zod instead",
        },
      ],
    },
  },
  {
    name: "test-files-allow-direct-imports",
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "no-restricted-imports": "off", // Allow direct imports in tests
    },
  },
]);
```

## Scope Restrictions

Prevent imports from specific package paths (e.g., internal adapters):

**TypeScript (eslint.config.ts):**

```typescript
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    name: "restrict-validator-imports",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          name: "zod",
          message: "Import from @ws-kit/zod instead",
        },
        {
          name: "@ws-kit/zod/adapter", // Prevent internal imports
          message:
            "Do not import adapters directly. Import from @ws-kit/zod main entry.",
        },
      ],
    },
  },
]);
```

## Testing the Configuration

### ✅ Allowed Imports

These imports will pass ESLint:

```typescript
// Zod
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { wsClient } from "@ws-kit/client/zod";

// Valibot
import { v, message, createRouter } from "@ws-kit/valibot";
import { wsClient } from "@ws-kit/client/valibot";
```

### ❌ Forbidden Imports

These will trigger ESLint errors:

```typescript
// ❌ ERROR: Import from @ws-kit/zod instead
import { z } from "zod";
import { ZodSchema } from "zod";

// ❌ ERROR: Import from @ws-kit/valibot instead
import { parse } from "valibot";
import * as v from "valibot";
```

## Integration with TypeScript

ESLint can work alongside TypeScript's strict mode:

**tsconfig.json:**

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Pre-commit Hook

Enforce ESLint before commits using husky + lint-staged:

**package.json:**

```json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx,js}": "eslint --report-unused-disable-directives --fix",
    "*.{ts,tsx,js,json,md}": "prettier --write"
  }
}
```

Install and set up husky:

```bash
bun add -D husky lint-staged
bun prepare
echo 'bunx lint-staged' > .husky/pre-commit
```

**Note:** The ws-kit project itself uses a simpler lint-staged configuration that only runs Prettier. The example above shows best practices for application projects that want to enforce both ESLint and Prettier on commit.

## CI/CD Integration

Add ESLint to your CI pipeline:

**GitHub Actions (.github/workflows/lint.yml):**

```yaml
name: Lint

on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run lint
```

**Package scripts (package.json):**

```json
{
  "scripts": {
    "lint": "eslint --report-unused-disable-directives .",
    "lint:fix": "eslint --report-unused-disable-directives --fix ."
  }
}
```

## Complete Example

Here's a full ESLint configuration for a ws-kit project using Zod:

**eslint.config.ts:**

```typescript
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tslint from "typescript-eslint";

export default defineConfig([
  {
    name: "global-ignores",
    ignores: ["node_modules", "dist/", ".bun/"],
  },
  {
    name: "eslint-recommended",
    extends: [eslint.configs.recommended],
  },
  {
    name: "typescript-configs",
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    extends: [
      ...tslint.configs.recommended,
      ...tslint.configs.strict,
      ...tslint.configs.stylistic,
    ],
  },
  {
    name: "restrict-validator-imports",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          name: "zod",
          message:
            "Import Zod from @ws-kit/zod instead to prevent dual-package hazards. " +
            "Use: import { z, message, createRouter } from '@ws-kit/zod'",
        },
      ],
    },
  },
  {
    name: "test-files-relaxed",
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  {
    name: "prettier-overrides",
    extends: [prettier],
  },
]);
```

## ws-kit Project Configuration

For reference, here's the actual ESLint configuration used in the ws-kit monorepo:

**eslint.config.ts:**

```typescript
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tslint from "typescript-eslint";

export default defineConfig([
  {
    name: "global-ignores",
    ignores: [
      "node_modules",
      ".bun/",
      ".vitepress/dist",
      ".vitepress/cache",
      "docs/",
      "packages/*/dist/",
    ],
  },
  {
    name: "eslint-recommended",
    extends: [eslint.configs.recommended],
  },
  {
    name: "typescript-configs",
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    extends: [
      ...tslint.configs.recommended,
      ...tslint.configs.strict,
      ...tslint.configs.stylistic,
    ],
  },
  {
    name: "test-files-relaxed",
    files: ["packages/**/test/**/*.ts", "packages/**/test/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  {
    name: "example-files-relaxed",
    files: ["examples/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    name: "prettier-overrides",
    extends: [prettier],
  },
]);
```

**Key differences from application projects:**

- **No `no-restricted-imports` rule** — ws-kit packages need direct access to Zod/Valibot for adapter implementation
- **More comprehensive ignores** — Ignores VitePress docs, package dist directories, and example projects
- **Separate test and example file rules** — Test files have relaxed TypeScript rules for convenience

## Summary

| Step                | Configuration                    |
| ------------------- | -------------------------------- |
| 1. Choose validator | Zod or Valibot                   |
| 2. Add ESLint rule  | `no-restricted-imports`          |
| 3. Add exceptions   | Test files, utilities (optional) |
| 4. Run locally      | `bun run lint`                   |
| 5. Add to CI        | GitHub Actions or equivalent     |

The combination of ESLint + proper imports prevents discriminated union issues and ensures type safety across your codebase.

## Legacy Configuration (ESLint 8.x)

If you're still using ESLint 8.x with the legacy `.eslintrc` format, here's the equivalent configuration:

**JavaScript (.eslintrc.js):**

```javascript
module.exports = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        name: "zod",
        message:
          "Import Zod from @ws-kit/zod instead to prevent dual-package hazards. " +
          "Use: import { z, message, createRouter } from '@ws-kit/zod'",
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.spec.ts"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
  ],
};
```

**JSON (.eslintrc.json):**

```json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "name": "zod",
        "message": "Import Zod from @ws-kit/zod instead to prevent dual-package hazards. Use: import { z, message, createRouter } from '@ws-kit/zod'"
      }
    ]
  },
  "overrides": [
    {
      "files": ["**/*.test.ts", "**/*.spec.ts"],
      "rules": {
        "no-restricted-imports": "off"
      }
    }
  ]
}
```

**Note:** ESLint 8.x is deprecated. We recommend upgrading to ESLint 9.x and using the flat config format shown in the main sections above.

## See Also

- [ADR-007: Export-with-Helpers Pattern](./adr/007-export-with-helpers-pattern.md)
- [Message Schemas](./message-schemas.md)
- [ESLint Documentation](https://eslint.org/docs/latest/rules/no-restricted-imports)
- [ESLint Flat Config Migration Guide](https://eslint.org/docs/latest/use/configure/migration-guide)
