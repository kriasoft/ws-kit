/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tslint from "typescript-eslint";

export default tslint.config(
  {
    // Global ignores
    ignores: ["node_modules", ".bun/"],
  },
  // Base ESLint recommended rules
  eslint.configs.recommended,
  // Base TypeScript recommended rules,
  ...tslint.configs.recommended,
  ...tslint.configs.strict,
  ...tslint.configs.stylistic,
  // Prettier config must be last to override other formatting rules
  prettier,
);
