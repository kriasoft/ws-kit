// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import type { DurableObjectNamespace, DurableObjectStub } from "./types.js";

/**
 * Compute a stable shard name from a topic string.
 *
 * Uses a simple bitwise hash to consistently map topic strings to shard names.
 * The same topic always produces the same shard name, enabling stable routing.
 *
 * **Stability**: Hash is deterministic across runtimes (no crypto, no randomness).
 * Changing `shards` count will remappings—plan accordingly (migration period recommended).
 *
 * @param topic - The topic string (room ID, user ID, tenant ID, etc.)
 * @param shards - Number of shards to distribute across
 * @param prefix - Shard name prefix (default: `ws-router`)
 *
 * @returns Shard name, e.g., `ws-router-3`
 *
 * @example
 * ```typescript
 * import { topicToDoName } from "@ws-kit/cloudflare-do/sharding";
 *
 * // Consistent mapping
 * topicToDoName("room:general", 10) // → "ws-router-2"
 * topicToDoName("room:general", 10) // → "ws-router-2" (same every time)
 * topicToDoName("room:random", 10)  // → "ws-router-7"
 *
 * // Different shard count remaps
 * topicToDoName("room:general", 20) // → "ws-router-12" (different!)
 * ```
 */
export function topicToDoName(
  topic: string,
  shards: number,
  prefix = "ws-router",
): string {
  let hash = 0;
  for (let i = 0; i < topic.length; i++) {
    hash = (hash << 5) - hash + topic.charCodeAt(i);
    hash = hash | 0; // Convert to 32-bit signed integer
  }
  return `${prefix}-${(hash >>> 0) % shards}`;
}

/**
 * Get a Durable Object ID for a given topic, using stable sharding.
 *
 * Combines `topicToDoName` with the namespace's `idFromName` API.
 *
 * **Usage in Worker**:
 * ```typescript
 * const doId = getShardedDoId(env, "room:general", 10);
 * const stub = env.ROUTER.get(doId);
 * return stub.fetch(req);
 * ```
 *
 * @param env - Environment with a Durable Object namespace (e.g., `{ ROUTER: ... }`)
 * @param topic - The topic to shard (room ID, user ID, etc.)
 * @param shards - Number of shards
 * @param prefix - Shard name prefix (default: `ws-router`)
 *
 * @returns A Durable Object ID string
 *
 * @example
 * ```typescript
 * import { getShardedDoId } from "@ws-kit/cloudflare-do/sharding";
 *
 * // In a Worker fetch handler
 * const doId = getShardedDoId(env, `room:${roomId}`, 10);
 * // Then: env.ROUTER.get(doId)
 * ```
 */
export function getShardedDoId(
  env: { ROUTER: DurableObjectNamespace },
  topic: string,
  shards: number,
  prefix?: string,
): string {
  const shardName = topicToDoName(topic, shards, prefix);
  return env.ROUTER.idFromName(shardName);
}

/**
 * Get a Durable Object stub (ready for `fetch()`) for a given topic.
 *
 * Convenience wrapper: compute the shard name, get the ID, then fetch the stub.
 * This is the typical path: topic → shard name → ID → stub → fetch.
 *
 * **Usage**:
 * ```typescript
 * import { getShardedStub } from "@ws-kit/cloudflare-do/sharding";
 *
 * const stub = getShardedStub(env, `room:${roomId}`, 10);
 * return stub.fetch(req); // Upgrade and route to the right DO
 * ```
 *
 * @param env - Environment with a Durable Object namespace
 * @param topic - The topic to shard
 * @param shards - Number of shards
 * @param prefix - Shard name prefix (default: `ws-router`)
 *
 * @returns A Durable Object stub ready for `fetch()`
 *
 * @example
 * ```typescript
 * import { getShardedStub } from "@ws-kit/cloudflare-do/sharding";
 *
 * export default {
 *   async fetch(req: Request, env: Env) {
 *     const roomId = new URL(req.url).searchParams.get("room") ?? "general";
 *     const stub = getShardedStub(env, `room:${roomId}`, 10);
 *     return stub.fetch(req);
 *   },
 * };
 * ```
 */
export function getShardedStub(
  env: { ROUTER: DurableObjectNamespace },
  topic: string,
  shards: number,
  prefix?: string,
): DurableObjectStub {
  const shardName = topicToDoName(topic, shards, prefix);
  const doId = env.ROUTER.idFromName(shardName);
  return env.ROUTER.get(doId);
}
