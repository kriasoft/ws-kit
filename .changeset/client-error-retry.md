---
"@ws-kit/client": minor
---

Enhanced error handling: clients now automatically infer retry behavior from error codes. Added support for `retryable` and `retryAfterMs` fields in error responses. Updated request-response correlation to handle both success and error cases with full type safety.
