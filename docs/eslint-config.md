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

## Configuration

### For Zod Users

Add this to `.eslintrc.js` or `.eslintrc.json`:

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
  }
}
```

### For Valibot Users

**JavaScript (.eslintrc.js):**

```javascript
module.exports = {
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
};
```

**JSON (.eslintrc.json):**

```json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "name": "valibot",
        "message": "Import Valibot from @ws-kit/valibot instead to prevent dual-package hazards. Use: import { v, message, createRouter } from '@ws-kit/valibot'"
      }
    ]
  }
}
```

### For Both Validators

If your project might use both (e.g., server + client):

**JavaScript (.eslintrc.js):**

```javascript
module.exports = {
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
};
```

## Allow Exceptions

To allow direct imports in specific files (e.g., test files or utilities):

**JavaScript (.eslintrc.js):**

```javascript
module.exports = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        name: "zod",
        message: "Import from @ws-kit/zod instead",
        // Allow imports in files matching this pattern
        importNames: ["ZodError"], // Allow specific imports
      },
    ],
  },

  // Or allow entire files
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.spec.ts"],
      rules: {
        "no-restricted-imports": "off", // Allow direct imports in tests
      },
    },
  ],
};
```

## Scope Restrictions

Prevent imports from specific package paths (e.g., internal adapters):

**JavaScript (.eslintrc.js):**

```javascript
module.exports = {
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
};
```

## Testing the Configuration

### ✅ Allowed Imports

These imports will pass ESLint:

```typescript
// Zod
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/serve/bun";
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
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged"
    }
  },
  "lint-staged": {
    "*.{ts,tsx}": "eslint --fix",
    "*.{ts,tsx,json}": "prettier --write"
  }
}
```

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
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run lint
```

**bun scripts (package.json):**

```json
{
  "scripts": {
    "lint": "eslint . --ext .ts,.tsx",
    "lint:fix": "eslint . --ext .ts,.tsx --fix"
  }
}
```

## Summary

| Step                | Configuration                    |
| ------------------- | -------------------------------- |
| 1. Choose validator | Zod or Valibot                   |
| 2. Add ESLint rule  | `no-restricted-imports`          |
| 3. Add exceptions   | Test files, utilities (optional) |
| 4. Run locally      | `bun run lint`                   |
| 5. Add to CI        | GitHub Actions or equivalent     |

The combination of ESLint + proper imports prevents discriminated union issues and ensures type safety across your codebase.

## See Also

- [ADR-007: Export-with-Helpers Pattern](./adr/007-export-with-helpers-pattern.md)
- [Message Schemas](./message-schemas.md)
- [ESLint Documentation](https://eslint.org/docs/latest/rules/no-restricted-imports)
