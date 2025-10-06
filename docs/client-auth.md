# Authentication

The WebSocket client supports flexible token-based authentication with automatic refresh on reconnection.

## Quick Start

```typescript
import { createClient } from "bun-ws-router/zod/client"; // ✅ Typed client

const client = createClient({
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
const client = createClient({
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
const client = createClient({
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
createClient({
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
createClient({
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

const client = createClient({
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
const client = createClient({
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
const client = createClient({
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
  createClient({
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

### Bun WebSocket Router

```typescript
import { WebSocketRouter } from "bun-ws-router/zod";

const router = new WebSocketRouter();

Bun.serve({
  fetch(req, server) {
    // Extract token from query string
    const url = new URL(req.url);
    const token = url.searchParams.get("access_token");

    if (!token || !validateToken(token)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const userId = getUserIdFromToken(token);

    // router.upgrade() auto-generates clientId (UUID v7) and returns Response
    return router.upgrade(req, {
      server,
      data: { userId },
    });
  },
  websocket: router.websocket,
});
```

### Protocol-Based Auth

```typescript
Bun.serve({
  fetch(req, server) {
    const protocols = req.headers.get("sec-websocket-protocol");
    const token = protocols
      ?.split(",")
      .map((p) => p.trim())
      .find((p) => p.startsWith("bearer."))
      ?.slice(7); // Remove "bearer." prefix

    if (!token || !validateToken(token)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const userId = getUserIdFromToken(token);

    // router.upgrade() auto-generates clientId (UUID v7) and returns Response
    return router.upgrade(req, {
      server,
      data: { userId },
      headers: {
        "Sec-WebSocket-Protocol": "bearer." + token, // Select auth protocol
      },
    });
  },
  websocket: router.websocket,
});
```

## Security Best Practices

### Use TLS (wss://)

```typescript
// ✅ Secure
const client = createClient({
  url: "wss://api.example.com/ws",
  auth: { getToken: () => token },
});

// ❌ Insecure (development only)
const client = createClient({
  url: "ws://localhost:3000/ws",
  auth: { getToken: () => token },
});
```

### Short-Lived Tokens

```typescript
// ✅ Token expires in 15 minutes
const client = createClient({
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
const client = createClient({
  url: "wss://api.example.com/ws",
  wsFactory: (url) => {
    const ws = new WebSocket(url);
    // Custom headers or auth handled by server proxy
    return ws;
  },
});
```
