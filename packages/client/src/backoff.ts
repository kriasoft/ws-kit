// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Exponential backoff calculation with optional jitter.
 * See @specs/client.md for backoff formula.
 */

export function calculateBackoff(
  attempt: number,
  config: {
    initialDelayMs: number;
    maxDelayMs: number;
    jitter: "full" | "none";
  },
): number {
  // delay = min(maxDelayMs, initialDelayMs × 2^(attempt-1))
  const exponentialDelay = config.initialDelayMs * Math.pow(2, attempt - 1);
  const cappedDelay = Math.min(config.maxDelayMs, exponentialDelay);

  if (config.jitter === "none") {
    return cappedDelay;
  }

  // Full jitter: random(0, delay)
  return Math.floor(Math.random() * (cappedDelay + 1));
}
