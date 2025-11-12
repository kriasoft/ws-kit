// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Canonical default topic validation pattern.
 *
 * Allows alphanumeric, colons, underscores, hyphens, dots, slashes. Max 128 chars.
 * Per docs/specs/pubsub.md#topic-validation
 *
 * Convention:
 * - Lowercase only (normalize mixed case via usePubSub({ normalize: t => t.toLowerCase() }))
 * - Use `:` for namespaces (room:123)
 * - Use `/` for hierarchy (tenant/acme)
 * - Use `.` for versions/kinds (v1.messages)
 * - Use `-`/`_` inside tokens
 *
 * This is the default; apps can override via router.limits.topicPattern
 */
export const DEFAULT_TOPIC_PATTERN = /^[a-z0-9:_./-]{1,128}$/i;

/**
 * Maximum allowed topic length in characters.
 *
 * This is the default; apps can override via router.limits.maxTopicLength
 */
export const DEFAULT_TOPIC_MAX_LENGTH = 128;
