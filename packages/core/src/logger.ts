// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

/**
 * Logger adapter interface for structured logging in WebSocket routers.
 *
 * Allows applications to integrate their own logging solutions (Winston, Pino,
 * structured logging services) instead of console.log.
 *
 * @example
 * ```typescript
 * import { createRouter } from "@ws-kit/zod";
 * import type { LoggerAdapter } from "@ws-kit/core";
 *
 * // Custom logger implementation
 * class MyLogger implements LoggerAdapter {
 *   debug(context: string, message: string, data?: unknown) {
 *     console.debug(`[${context}] ${message}`, data);
 *   }
 *
 *   info(context: string, message: string, data?: unknown) {
 *     console.log(`[${context}] ${message}`, data);
 *   }
 *
 *   warn(context: string, message: string, data?: unknown) {
 *     console.warn(`[${context}] ${message}`, data);
 *   }
 *
 *   error(context: string, message: string, data?: unknown) {
 *     console.error(`[${context}] ${message}`, data);
 *   }
 * }
 *
 * const router = createRouter({
 *   logger: new MyLogger(),
 * });
 * ```
 */
export interface LoggerAdapter {
  /**
   * Log a debug-level message
   *
   * @param context - Category or source of the log (e.g., "connection", "heartbeat")
   * @param message - Log message
   * @param data - Optional structured data
   */
  debug(context: string, message: string, data?: unknown): void;

  /**
   * Log an info-level message
   *
   * @param context - Category or source of the log
   * @param message - Log message
   * @param data - Optional structured data
   */
  info(context: string, message: string, data?: unknown): void;

  /**
   * Log a warning-level message
   *
   * @param context - Category or source of the log
   * @param message - Log message
   * @param data - Optional structured data
   */
  warn(context: string, message: string, data?: unknown): void;

  /**
   * Log an error-level message
   *
   * @param context - Category or source of the log
   * @param message - Log message
   * @param data - Optional structured data (error details, stack trace, etc.)
   */
  error(context: string, message: string, data?: unknown): void;
}

/**
 * Default logger adapter that uses console methods
 *
 * @internal
 */
export class DefaultLoggerAdapter implements LoggerAdapter {
  debug(context: string, message: string, data?: unknown): void {
    console.debug(`[${context}] ${message}`, data);
  }

  info(context: string, message: string, data?: unknown): void {
    console.info(`[${context}] ${message}`, data);
  }

  warn(context: string, message: string, data?: unknown): void {
    console.warn(`[${context}] ${message}`, data);
  }

  error(context: string, message: string, data?: unknown): void {
    console.error(`[${context}] ${message}`, data);
  }
}

/**
 * Create a logger adapter that uses custom console methods
 *
 * @param options - Configuration options
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * // Use custom console (e.g., structured logging service)
 * const logger = createConsoleLogger({
 *   log: (level, context, message, data) => {
 *     // Send to logging service
 *     logService.log({
 *       level,
 *       context,
 *       message,
 *       data,
 *       timestamp: new Date(),
 *     });
 *   },
 * });
 * ```
 */
export interface LoggerOptions {
  /**
   * Custom log function
   *
   * @param level - Log level (debug, info, warn, error)
   * @param context - Category or source
   * @param message - Message
   * @param data - Optional structured data
   */
  log?: (
    level: "debug" | "info" | "warn" | "error",
    context: string,
    message: string,
    data?: unknown,
  ) => void;

  /**
   * Minimum log level to output (default: "debug")
   * - 0: debug
   * - 1: info
   * - 2: warn
   * - 3: error
   */
  minLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Create a logger adapter with custom configuration
 */
export function createLogger(options: LoggerOptions = {}): LoggerAdapter {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel = options.minLevel ?? "debug";
  const minLevelValue = levels[minLevel];

  return {
    debug(context, message, data) {
      if (levels.debug >= minLevelValue) {
        options.log?.("debug", context, message, data) ||
          console.debug(`[${context}] ${message}`, data);
      }
    },

    info(context, message, data) {
      if (levels.info >= minLevelValue) {
        options.log?.("info", context, message, data) ||
          console.info(`[${context}] ${message}`, data);
      }
    },

    warn(context, message, data) {
      if (levels.warn >= minLevelValue) {
        options.log?.("warn", context, message, data) ||
          console.warn(`[${context}] ${message}`, data);
      }
    },

    error(context, message, data) {
      if (levels.error >= minLevelValue) {
        options.log?.("error", context, message, data) ||
          console.error(`[${context}] ${message}`, data);
      }
    },
  };
}

/**
 * Log context constants used by ws-kit router
 *
 * Applications can use these to filter or categorize logs
 */
export const LOG_CONTEXT = {
  CONNECTION: "connection",
  HEARTBEAT: "heartbeat",
  MESSAGE: "message",
  MIDDLEWARE: "middleware",
  AUTH: "auth",
  VALIDATION: "validation",
  ERROR: "error",
} as const;
