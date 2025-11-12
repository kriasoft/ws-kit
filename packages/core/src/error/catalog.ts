/**
 * Error catalog: documented error codes and scenarios across all packages.
 *
 * Format: `{AREA}{NUMBER} CodeName — Human-readable message`
 * - AREA: WSZ (Zod validator), WSP (Pub/Sub), WSR (Router/Core), WSV (Valibot)
 * - NUMBER: Sequential ID (001, 002, ...)
 * - Use @internal to avoid exposing this in public API
 *
 * @internal
 */

/**
 * Zod validator errors (WSZ prefix).
 * Thrown during validation plugin setup or RPC/message handling.
 */
export const ZOD_ERRORS = {
  /** WSZ001: API requires validator plugin */
  MISSING_VALIDATOR:
    "This API requires the withZod() plugin to be enabled. Add it to your router.",

  /** WSZ002: ctx.reply() called outside RPC handler */
  REPLY_OUTSIDE_RPC:
    "ctx.reply() is only available in RPC handlers. Use it inside router.rpc(), not router.on().",

  /** WSZ003: Multiple terminal replies sent */
  MULTIPLE_TERMINAL_REPLY:
    "RPC handler already replied. Only one terminal reply (via ctx.reply()) is allowed per request.",

  /** WSZ004: Outbound (response) validation failed */
  OUTBOUND_VALIDATION_FAILED:
    "Response validation failed. Check the response payload matches the schema defined in rpc().",

  /** WSZ005: Inbound (request) validation failed */
  INBOUND_VALIDATION_FAILED:
    "Request validation failed. Check the incoming message matches the schema defined in message() or rpc().",

  /** WSZ006: Invalid schema passed to handler */
  INVALID_SCHEMA:
    "Handler schema must be created with message() or rpc(), not passed directly.",
} as const;

/**
 * Pub/Sub errors (WSP prefix).
 * Thrown when publishing, subscribing, or using topics without the plugin.
 */
export const PUBSUB_ERRORS = {
  /** WSP001: API requires pub/sub plugin */
  MISSING_PUBSUB:
    "Topics API requires the withPubSub() plugin. Add it to your router.",

  /** WSP002: Invalid topic name format */
  INVALID_TOPIC_NAME:
    "Topic name must be a non-empty string without leading/trailing spaces.",

  /** WSP003: Publish failed */
  PUBLISH_FAILED:
    "Failed to publish message to topic. Check the adapter configuration.",
} as const;

/**
 * Router/Core errors (WSR prefix).
 * Thrown during router initialization, route registration, or validation.
 */
export const ROUTER_ERRORS = {
  /** WSR001: Handler requires valid schema */
  HANDLER_SCHEMA_REQUIRED:
    "Handler requires a schema created with message() or rpc().",

  /** WSR002: Schema kind mismatch */
  SCHEMA_KIND_MISMATCH:
    "Schema kind mismatch. Expected RPC schema in router.rpc(), got event schema.",

  /** WSR003: Reserved message type */
  RESERVED_TYPE_USED:
    "Message type cannot start with $ws: (reserved for system messages).",

  /** WSR004: Invalid connection data type */
  INVALID_CONNECTION_DATA:
    "Connection data must have a clientId field for type safety.",
} as const;

/**
 * Valibot validator errors (WSV prefix).
 * Thrown during validation plugin setup or RPC/message handling (Valibot variant).
 */
export const VALIBOT_ERRORS = {
  /** WSV001: API requires validator plugin */
  MISSING_VALIDATOR:
    "This API requires the withValibot() plugin to be enabled. Add it to your router.",

  /** WSV002: ctx.reply() called outside RPC handler */
  REPLY_OUTSIDE_RPC:
    "ctx.reply() is only available in RPC handlers. Use it inside router.rpc(), not router.on().",

  /** WSV003: Multiple terminal replies sent */
  MULTIPLE_TERMINAL_REPLY:
    "RPC handler already replied. Only one terminal reply (via ctx.reply()) is allowed per request.",

  /** WSV004: Outbound validation failed */
  OUTBOUND_VALIDATION_FAILED:
    "Response validation failed. Check the response payload matches the schema defined in rpc().",

  /** WSV005: Inbound validation failed */
  INBOUND_VALIDATION_FAILED:
    "Request validation failed. Check the incoming message matches the schema defined in message() or rpc().",

  /** WSV006: Invalid schema */
  INVALID_SCHEMA:
    "Handler schema must be created with message() or rpc(), not passed directly.",
} as const;

/**
 * Map area prefix to error codes for documentation/validation.
 * Format: prefix → { code: message }
 */
export const ERROR_CATALOG = {
  WSZ: ZOD_ERRORS,
  WSP: PUBSUB_ERRORS,
  WSR: ROUTER_ERRORS,
  WSV: VALIBOT_ERRORS,
} as const;

/**
 * Get all error codes for documentation generation.
 * Useful for generating error reference docs.
 */
export function getAllErrorCodes(): Array<{
  code: string;
  area: string;
  number: string;
  message: string;
}> {
  const codes: Array<{
    code: string;
    area: string;
    number: string;
    message: string;
  }> = [];

  for (const [area, errors] of Object.entries(ERROR_CATALOG)) {
    // Extract error names and format as codes
    for (const [errorKey, message] of Object.entries(errors)) {
      // Convert SCREAMING_SNAKE_CASE to sequential number
      const keys = Object.keys(errors);
      const number = String(keys.indexOf(errorKey) + 1).padStart(3, "0");
      const code = `${area}${number}`;

      codes.push({
        code,
        area,
        number,
        message: message as string,
      });
    }
  }

  return codes;
}
