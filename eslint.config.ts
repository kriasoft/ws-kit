/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

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
    name: "prettier-overrides",
    extends: [prettier],
  },
]);
