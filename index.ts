/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

// For backward compatibility, export Zod-based implementation as default
export * from "./zod/index";

// Also export shared types that are validator-agnostic
export type { WebSocketData, UpgradeOptions } from "./shared/types";
