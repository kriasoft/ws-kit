// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tslint from "typescript-eslint";

export default defineConfig([
  {
    name: "global-ignores",
    ignores: ["node_modules", ".bun/", "dist/", "docs/"],
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
