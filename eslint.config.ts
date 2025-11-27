// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

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
    files: ["**/*.test.ts"],
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
    name: "pubsub-canonical-types",
    files: ["packages/core/src/capabilities/pubsub/adapter.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'ExportNamedDeclaration[declaration.type="TSTypeAliasDeclaration"][declaration.id.name=/^(PublishResult|PublishError|PublishCapability|PublishOptions)$/]',
          message:
            "{{ name }} must be defined in core/types.ts only. Re-export from there instead.",
        },
      ],
    },
  },
  {
    name: "prettier-overrides",
    extends: [prettier],
  },
]);
