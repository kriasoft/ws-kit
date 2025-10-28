// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Authentication token attachment for WebSocket connections.
 * See @specs/client.md#protocol-merging for protocol handling.
 */

export interface AuthConfig {
  getToken?: () =>
    | string
    | null
    | undefined
    | Promise<string | null | undefined>;
  attach?: "query" | "protocol";
  queryParam?: string;
  protocolPrefix?: string;
  protocolPosition?: "append" | "prepend";
}

/**
 * Validates protocolPrefix doesn't contain spaces or commas (RFC 6455).
 * Throws TypeError if invalid.
 */
export function validateProtocolPrefix(prefix: string): void {
  if (!/^[^\s,]+$/.test(prefix)) {
    throw new TypeError(
      `Invalid protocolPrefix: "${prefix}" (must not contain spaces/commas)`,
    );
  }
}

/**
 * Attaches auth token to URL as query parameter.
 */
export function attachTokenToUrl(
  url: string | URL,
  token: string,
  queryParam: string,
): URL {
  const urlObj = typeof url === "string" ? new URL(url) : new URL(url.href);
  urlObj.searchParams.set(queryParam, token);
  return urlObj;
}

/**
 * Merges user protocols with auth token protocol.
 * Returns combined protocols array with deduplication.
 */
export function mergeProtocols(
  userProtocols: string | string[] | undefined,
  token: string | null | undefined,
  protocolPrefix: string,
  protocolPosition: "append" | "prepend",
): string[] | undefined {
  // Normalize user protocols to array
  const normalized: string[] =
    userProtocols === undefined
      ? []
      : Array.isArray(userProtocols)
        ? userProtocols
        : [userProtocols];

  // Generate token protocol if token exists
  const tokenProtocol =
    token !== null && token !== undefined ? `${protocolPrefix}${token}` : null;

  // Combine based on position
  const combined =
    tokenProtocol === null
      ? normalized
      : protocolPosition === "prepend"
        ? [tokenProtocol, ...normalized]
        : [...normalized, tokenProtocol];

  // Deduplicate preserving first occurrence
  const seen = new Set<string>();
  const deduplicated = combined.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  // Filter out empty strings (prevent malformed header)
  const filtered = deduplicated.filter((p) => p !== "");

  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Retrieves auth token (handles sync/async getToken).
 */
export async function getAuthToken(
  getToken?: () =>
    | string
    | null
    | undefined
    | Promise<string | null | undefined>,
): Promise<string | null | undefined> {
  if (!getToken) return undefined;
  return await getToken();
}
