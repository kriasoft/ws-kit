/**
 * JSON utilities: safe parse/stringify with size checking.
 * Size limits tied to maxPayloadBytes config.
 */

export interface ParseResult<T = unknown> {
  ok: true;
  value: T;
}

export interface ParseError {
  ok: false;
  error: string;
}

export type ParseOutcome<T = unknown> = ParseResult<T> | ParseError;

/**
 * Parse JSON safely with optional size limit.
 * Returns a result object instead of throwing.
 */
export function safeJsonParse(
  data: string,
  maxBytes?: number,
): ParseOutcome {
  // Check size first
  if (maxBytes && data.length > maxBytes) {
    return {
      ok: false,
      error: `Message exceeds max payload size: ${data.length} > ${maxBytes}`,
    };
  }

  try {
    const value = JSON.parse(data);
    return { ok: true, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export function safeJsonStringify(
  obj: unknown,
  maxBytes?: number,
): string {
  const json = JSON.stringify(obj);
  if (maxBytes && json.length > maxBytes) {
    throw new Error(`Serialized message exceeds max payload size: ${json.length} > ${maxBytes}`);
  }
  return json;
}
