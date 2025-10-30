# Authentication

The WebSocket client supports flexible token-based authentication with automatic refresh on reconnection.

## Quick Start

```typescript
import { wsClient } from "@ws-kit/client/zod"; // ✅ Typed client

const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: () => localStorage.getItem("access_token"),
    attach: "query", // or "protocol"
  },
});

await client.connect();
```

## Auth Configuration

### Basic Options

```typescript
auth?: {
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  attach?: "query" | "protocol";  // default: "query"
  queryParam?: string;             // default: "access_token"
  protocolPrefix?: string;         // default: "bearer."
  protocolPosition?: "append" | "prepend";  // default: "append"
}
```

**`getToken`** - Token retrieval function

- Called once per (re)connect
- Supports sync or async
- Return `null`/`undefined` to skip auth

**`attach`** - How to send token

- `"query"` (default): Append to URL query string
- `"protocol"`: Send via WebSocket subprotocol

**`queryParam`** - Query parameter name (default: `"access_token"`)

**`protocolPrefix`** - Protocol prefix (default: `"bearer."`)

**`protocolPosition`** - Where to place auth protocol (default: `"append"`)

## Attach Methods

### Query String (Default)

Append token as URL query parameter.

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: () => "abc123",
    attach: "query", // default
    queryParam: "access_token", // default
  },
});

// Connects to: wss://api.example.com/ws?access_token=abc123
```

**Security notes:**

- Tokens in URLs may be logged by browsers, proxies, or servers
- Use short-lived tokens
- Always use `wss://` (TLS) in production

### WebSocket Protocol

Send token via `Sec-WebSocket-Protocol` header.

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  protocols: "chat-v2", // Your app protocol
  auth: {
    getToken: () => "abc123",
    attach: "protocol",
    protocolPrefix: "bearer.", // default
    protocolPosition: "append", // default
  },
});

// WebSocket receives protocols: ["chat-v2", "bearer.abc123"]
```

**Security notes:**

- Headers visible in plaintext over non-TLS
- Always use `wss://` (TLS) for production
- Avoid logging headers on proxies

## Protocol Merging

When using `attach: "protocol"` with user protocols, the client merges them intelligently.

### Append (Default)

Token protocol added after user protocols:

```typescript
wsClient({
  url: "wss://api.example.com",
  protocols: "chat-v2",
  auth: {
    getToken: () => "abc123",
    attach: "protocol",
    protocolPosition: "append", // default
  },
});

// WebSocket constructor receives: ["chat-v2", "bearer.abc123"]
```

### Prepend

Token protocol added before user protocols (some servers require auth first):

```typescript
wsClient({
  url: "wss://api.example.com",
  protocols: "chat-v2",
  auth: {
    getToken: () => "abc123",
    attach: "protocol",
    protocolPosition: "prepend",
  },
});

// WebSocket constructor receives: ["bearer.abc123", "chat-v2"]
```

### Edge Cases

| Scenario            | Result (append)       | Result (prepend)      |
| ------------------- | --------------------- | --------------------- |
| No user protocols   | `["bearer.abc123"]`   | `["bearer.abc123"]`   |
| Token is `null`     | `["chat-v2"]`         | `["chat-v2"]`         |
| Duplicate protocols | First occurrence kept | First occurrence kept |

## Token Refresh

The `getToken()` function is called on every connection attempt, enabling automatic token refresh:

```typescript
let currentToken = "initial-token";

const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: { enabled: true },
  auth: {
    getToken: () => currentToken, // Fetched on each (re)connect
    attach: "query",
  },
});

// Later: update token (will be used on next reconnect)
currentToken = "refreshed-token";
```

### Async Token Refresh

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: async () => {
      // Fetch fresh token from auth service
      const response = await fetch("/api/auth/token");
      const { token } = await response.json();
      return token;
    },
    attach: "protocol",
  },
});
```

### With Token Storage

```typescript
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: {
    getToken: () => {
      // Get token from localStorage, sessionStorage, or cookie
      return localStorage.getItem("access_token");
    },
    attach: "query",
  },
});

// When user logs out, clear token
function logout() {
  localStorage.removeItem("access_token");
  client.close();
}
```

## Server Protocol Selection

The server selects ONE protocol from the client's list. Check which was selected:

```typescript
client.onState((state) => {
  if (state === "open") {
    console.log("Selected protocol:", client.protocol);

    // Validate server selected expected protocol
    if (client.protocol !== "chat-v2" && client.protocol !== "") {
      client.close({ code: 1002, reason: "Unsupported protocol" });
    }
  }
});
```

**Possible values:**

- `client.protocol === "bearer.abc123"` - Server selected token protocol
- `client.protocol === "chat-v2"` - Server selected app protocol
- `client.protocol === ""` - Server accepted connection but selected no protocol

## Validation

The client validates `protocolPrefix` before connecting:

```typescript
// ✅ Valid prefixes
"bearer.";
"auth-";
"token_";

// ❌ Invalid prefixes (throws TypeError)
"bearer "; // Contains space
"auth,"; // Contains comma
"my token"; // Contains space
```

**Error:**

```typescript
try {
  wsClient({
    url: "wss://api.example.com",
    auth: {
      getToken: () => "token",
      attach: "protocol",
      protocolPrefix: "bearer ", // Invalid!
    },
  }).connect();
} catch (err) {
  // TypeError: Invalid protocolPrefix: "bearer " (must not contain spaces/commas)
}
```

## Server Setup

Your server must be configured to accept the auth protocol.

### Bun Adapter

The `authenticate` function is called during WebSocket upgrade. Return connection data to accept, return `undefined` to accept without custom data, or throw an error to reject:

```typescript
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

type AppData = { userId?: string };

const router = createRouter<AppData>();

// Register your message handlers
router.on(SomeMessage, (ctx) => {
  console.log("User:", ctx.ws.data?.userId);
});

serve(router, {
  port: 3000,
  authenticate(req) {
    // Extract token from query string
    const url = new URL(req.url);
    const token = url.searchParams.get("access_token");

    if (!token) {
      return undefined; // Accept: no custom data attached
    }

    if (!validateToken(token)) {
      throw new Error("Unauthorized"); // Reject: connection fails with HTTP 500
    }

    const userId = getUserIdFromToken(token);
    return { userId }; // Accept: attach custom data to connection
  },
});
```

**Authentication Flow:**

- `authenticate()` is called during the WebSocket upgrade (before the connection is established)
- Return custom data to attach it to `ctx.ws.data` (merged with auto-generated `clientId`)
- Return `undefined` to accept the connection without custom data
- Throw an error to reject the connection (client receives HTTP 500)
- The function can be async (return `Promise<TData>`) for database lookups or API calls

**Connection Identity:**

- `clientId` is automatically generated by the server (UUID v7, time-ordered)
- You cannot override `clientId` - it's always server-generated for security
- Access via `ctx.ws.data.clientId` in all handlers and hooks
- Custom data returned from `authenticate()` is merged with `{ clientId }`

### Protocol-Based Auth

```typescript
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

type AppData = { userId?: string };

const router = createRouter<AppData>();

serve(router, {
  port: 3000,
  authenticate(req) {
    // Extract token from WebSocket protocol header
    const protocols = req.headers.get("sec-websocket-protocol");
    const token = protocols
      ?.split(",")
      .map((p) => p.trim())
      .find((p) => p.startsWith("bearer."))
      ?.slice(7); // Remove "bearer." prefix

    if (!token) {
      return undefined; // Accept connection without auth
    }

    if (!validateToken(token)) {
      throw new Error("Unauthorized"); // Reject connection
    }

    const userId = getUserIdFromToken(token);
    return { userId }; // Accept with custom data
  },
});
```

**Server Protocol Selection:**

The server automatically handles protocol selection during the WebSocket upgrade. Bun's `server.upgrade()` manages the `Sec-WebSocket-Protocol` response header based on the protocols sent by the client.

**Key Points:**

- The `authenticate()` function runs **before** protocol selection
- Extract auth token from the `sec-websocket-protocol` header
- The server may select any protocol from the client's list (or none)
- Check `client.protocol` on the client side to see which protocol was selected
- Protocol-based auth is more secure than query parameters (not logged in URLs)

### Async Authentication

For database lookups or external API calls, use async authentication:

```typescript
import { createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

type AppData = { userId: string; email: string; roles: string[] };

const router = createRouter<AppData>();

serve(router, {
  port: 3000,
  async authenticate(req) {
    // Extract token from Authorization header
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return undefined; // Anonymous connection
    }

    try {
      // Async token verification (e.g., JWT validation with database lookup)
      const payload = await verifyJWT(token);

      // Fetch user data from database
      const user = await db.users.findById(payload.userId);

      if (!user) {
        throw new Error("User not found");
      }

      // Return authenticated user data
      return {
        userId: user.id,
        email: user.email,
        roles: user.roles,
      };
    } catch (error) {
      // Reject connection on auth failure
      throw new Error("Invalid token");
    }
  },
});
```

**Benefits of Async Auth:**

- Database lookups to verify tokens
- External API calls for OAuth validation
- Complex permission checks before connection
- Rate limiting based on user identity

**Error Handling:**

- Throwing an error rejects the connection (HTTP 500)
- Returning `undefined` accepts anonymous connections
- Authentication runs once per connection (not per message)

## Security Best Practices

### Use TLS (wss://)

```typescript
// ✅ Secure
const client = wsClient({
  url: "wss://api.example.com/ws",
  auth: { getToken: () => token },
});

// ❌ Insecure (development only)
const client = wsClient({
  url: "ws://localhost:3000/ws",
  auth: { getToken: () => token },
});
```

### Short-Lived Tokens

```typescript
// ✅ Token expires in 15 minutes
const client = wsClient({
  url: "wss://api.example.com/ws",
  reconnect: { enabled: true },
  auth: {
    getToken: async () => {
      const { token, expiresAt } = await getShortLivedToken();
      return token;
    },
  },
});

// Server validates expiry on each message
```

### Avoid Logging Tokens

```typescript
// ❌ Don't log tokens
console.log("Token:", token);

// ✅ Log safely
console.log("Token length:", token?.length);
console.log("Has token:", !!token);
```

### Custom Auth Mechanisms

For custom auth (cookies, headers via proxy):

```typescript
// Use wsFactory for custom WebSocket creation
const client = wsClient({
  url: "wss://api.example.com/ws",
  wsFactory: (url) => {
    const ws = new WebSocket(url);
    // Custom headers or auth handled by server proxy
    return ws;
  },
});
```
