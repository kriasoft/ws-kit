import { z } from "zod";
import { messageSchema } from "../";

/**
 * Authentication message with JWT token
 */
export const AuthenticateMessage = messageSchema("AUTHENTICATE", {
  token: z.jwt(),
  apiVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
    .optional(), // Semver pattern
});

/**
 * Session creation response
 */
export const SessionCreatedMessage = messageSchema("SESSION_CREATED", {
  sessionId: z.ulid(),
  userId: z.uuid(), // UUID v7 in practice, validated as generic UUID
  expiresAt: z.coerce.date(),
});

/**
 * Request with nanoid for lightweight IDs
 */
export const CreateResourceMessage = messageSchema("CREATE_RESOURCE", {
  resourceId: z.nanoid(),
  name: z.string().min(1).max(100),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Email verification request
 */
export const VerifyEmailMessage = messageSchema("VERIFY_EMAIL", {
  email: z.email(),
  code: z.string().length(6),
});

/**
 * IP-based rate limiting message
 */
export const RateLimitMessage = messageSchema("RATE_LIMIT", {
  clientIp: z.ipv4(),
  requests: z.number().int().positive(),
  windowMs: z.number().int().positive(),
});

/**
 * Webhook configuration with URL validation
 */
export const ConfigureWebhookMessage = messageSchema("CONFIGURE_WEBHOOK", {
  url: z.url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(32),
});
