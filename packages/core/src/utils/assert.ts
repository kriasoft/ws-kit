/**
 * Assertions: invariant checks (dev + production).
 */

export function invariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(`Invariant: ${message}`);
  }
}

export function unreachable(message?: string): never {
  throw new Error(
    `Unreachable: ${message || "code path should not be reached"}`,
  );
}
