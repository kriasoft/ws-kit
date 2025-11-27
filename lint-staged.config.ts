// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { Configuration } from "lint-staged";

export default {
  "*.{ts,tsx,js}": ["prettier --write", () => "tsc --noEmit"],
  "*.{json,md}": ["prettier --write"],
} satisfies Configuration;
