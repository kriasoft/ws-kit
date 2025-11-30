// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Composition utilities for building unified PubSubAdapter from split concerns.
 * Internal API for adapter authors. Applications use the unified adapters directly.
 *
 * # Motivation
 *
 * PubSubAdapter is the public interface (what routers and apps see).
 * Internally, adapters are composed from:
 * - PubSubDriver: local subscription index + fan-out
 * - BrokerConsumer: distributed message ingestion (optional)
 *
 * This separation preserves modularity while keeping the public API lean.
 * withBroker() and combineBrokers() let adapter authors implement once, hide complexity.
 *
 * # Example: Redis Adapter
 *
 * ```ts
 * import { withBroker, createRedisDriver, createRedisConsumer } from "@ws-kit/redis";
 *
 * export function redisPubSub(redis: RedisClient): PubSubAdapter {
 *   const driver = createRedisDriver(redis);
 *   const consumer = createRedisConsumer(redis);
 *   return withBroker(driver, consumer);
 * }
 * ```
 *
 * # Example: Multi-Broker (Redis + Kafka Replay)
 *
 * ```ts
 * const adapter = withBroker(
 *   createRedisDriver(redis),
 *   combineBrokers(
 *     createRedisConsumer(redis),
 *     createKafkaConsumer(kafka),
 *   ),
 * );
 * ```
 */

import type {
  BrokerConsumer,
  PublishEnvelope,
  PubSubAdapter,
  PubSubDriver,
  StopFn,
} from "@ws-kit/core/pubsub";

/**
 * Start mode for combining multiple brokers.
 *
 * - "sequential" (default): Start brokers one by one, fail fast, rollback on first error.
 *   Safer, simpler error semantics, deterministic.
 * - "parallel": Start all brokers concurrently, wait for all, rollback any that succeeded on failure.
 *   Faster if broker starts are independent, but more complex error handling.
 */
export type BrokerStartMode = "sequential" | "parallel";

/**
 * Makes a stop function idempotent and safe.
 *
 * - Returned stop function is safe to call multiple times (only executes once)
 * - Normalizes sync and async stops uniformly
 * - Returns a no-op if stop is undefined or falsy
 *
 * @internal
 */
function onceStop(stop: StopFn | undefined): StopFn {
  if (!stop) {
    return async () => undefined;
  }

  let called = false;
  return async () => {
    if (called) return;
    called = true;
    await Promise.resolve(stop());
  };
}

/**
 * Validates and normalizes a stop function returned by a consumer.
 *
 * - Accepts: function (stopper), undefined/null (tolerate, produce no-op)
 * - Returns: idempotent StopFn
 * - Throws: if strict mode and stop is invalid type
 *
 * @internal
 */
function normalizeStop(stop: unknown, strict = false): StopFn {
  if (typeof stop === "function") {
    return onceStop(stop as StopFn);
  }
  if (!stop) {
    // Tolerate undefined/null (consumer forgot to return, or sync no-op)
    return async () => undefined;
  }
  // If strict mode, fail here; otherwise produce no-op and warn
  if (strict) {
    throw new Error(
      `BrokerConsumer.start() must return StopFn | Promise<StopFn>, got: ${typeof stop}`,
    );
  }
  // Lenient: log and continue
  console.warn(
    `[pubsub] BrokerConsumer.start() returned invalid stop type: ${typeof stop}`,
  );
  return async () => undefined;
}

/**
 * Compose a unified PubSubAdapter from split driver + optional consumer.
 * Adapter authors use this to combine local (driver) + distributed (consumer) concerns.
 *
 * The returned adapter is immutable (frozen) to prevent accidental mutation.
 *
 * @param driver - Local subscription index + fan-out
 * @param consumer - Optional: distributed message ingestion (broker consumer)
 * @returns Unified PubSubAdapter implementing all required methods
 *
 * @example
 * ```ts
 * const adapter = withBroker(createMemoryDriver());
 *
 * const adapter = withBroker(
 *   createRedisDriver(redis),
 *   createRedisConsumer(redis),
 * );
 * ```
 */
export function withBroker(
  driver: PubSubDriver,
  consumer?: BrokerConsumer,
): PubSubAdapter {
  return Object.freeze({
    // Required: delegate to driver
    publish: driver.publish.bind(driver),
    subscribe: driver.subscribe.bind(driver),
    unsubscribe: driver.unsubscribe.bind(driver),
    getSubscribers: driver.getSubscribers.bind(driver),

    // Optional: delegate convenience methods if present
    ...(driver.replace && { replace: driver.replace.bind(driver) }),
    ...(driver.listTopics && { listTopics: driver.listTopics.bind(driver) }),
    ...(driver.hasTopic && { hasTopic: driver.hasTopic.bind(driver) }),

    // Optional: handle distributed ingress if consumer provided
    ...(consumer && { start: consumer.start.bind(consumer) }),

    // Optional: cleanup
    ...(driver.close && { close: driver.close.bind(driver) }),
  }) as PubSubAdapter;
}

/**
 * Combine multiple broker consumers into one.
 * Enables multi-source ingestion (e.g., Redis + Kafka replay) with a single start() call.
 *
 * **Startup strategy**: Sequential (fail-fast)
 * - Start brokers one-by-one, stop immediately on first failure
 * - Roll back already-started brokers
 * - Simpler error semantics, deterministic startup order
 *
 * **Stop function safety:**
 * - Returned stop function is idempotent; safe to call multiple times
 * - All stops are wrapped and made safe before collection
 * - Uses Promise.allSettled to ensure all stops are attempted even if one fails
 *
 * @param consumers - Broker consumers to combine
 * @returns Combined consumer with unified teardown
 *
 * @example
 * ```ts
 * const consumer = combineBrokers(
 *   createRedisConsumer(redis),
 *   createKafkaConsumer(kafka),
 * );
 *
 * const adapter = withBroker(driver, consumer);
 * ```
 */
export function combineBrokers(...consumers: BrokerConsumer[]): BrokerConsumer {
  return {
    async start(
      onRemote: (envelope: PublishEnvelope) => void | Promise<void>,
    ): Promise<StopFn> {
      const stops: StopFn[] = [];

      // Sequential: start one-by-one, rollback on first failure
      try {
        for (const c of consumers) {
          const raw = await Promise.resolve(c.start(onRemote));
          const stop = normalizeStop(raw);
          stops.push(onceStop(stop));
        }
      } catch (e) {
        // Rollback: try to stop all started consumers
        await Promise.allSettled(stops.map((stop) => Promise.resolve(stop())));
        throw e;
      }

      // Return unified idempotent async stop function
      let stopped = false;
      return async () => {
        if (stopped) return;
        stopped = true;
        await Promise.allSettled(stops.map((stop) => Promise.resolve(stop())));
      };
    },
  };
}
