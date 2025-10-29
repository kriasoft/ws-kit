// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { z, message } from "@ws-kit/zod";

/**
 * Authentication message with JWT token
 */
export const AuthenticateMessage = message("AUTHENTICATE", {
  token: z.jwt(),
  apiVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
    .optional(), // Semver pattern
});

/**
 * Session creation response
 */
export const SessionCreatedMessage = message("SESSION_CREATED", {
  sessionId: z.ulid(),
  userId: z.uuid(), // UUID v7 in practice, validated as generic UUID
  expiresAt: z.coerce.date(),
});

/**
 * Request with nanoid for lightweight IDs
 */
export const CreateResourceMessage = message("CREATE_RESOURCE", {
  resourceId: z.nanoid(),
  name: z.string().min(1).max(100),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Email verification request
 */
export const VerifyEmailMessage = message("VERIFY_EMAIL", {
  email: z.email(),
  code: z.string().length(6),
});

/**
 * IP-based rate limiting message
 */
export const RateLimitMessage = message("RATE_LIMIT", {
  clientIp: z.ipv4(),
  requests: z.number().int().positive(),
  windowMs: z.number().int().positive(),
});

/**
 * Webhook configuration with URL validation
 */
export const ConfigureWebhookMessage = message("CONFIGURE_WEBHOOK", {
  url: z.url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(32),
});
