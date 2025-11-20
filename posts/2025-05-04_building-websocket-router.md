---
title: "Building Type-Safe WebSocket Applications with Bun and WS-Kit"
summary: "✨ Building real-time apps? Learn to tame WebSocket chaos with Bun and WS-Kit! This post introduces WS-Kit, a type-safe WebSocket router that brings clean routing and type safety to your Bun WebSocket messages, replacing messy switch statements with structured, validated handlers."
author: koistya
sidebar: false
head:
  - - link
    - rel: canonical
      href: https://medium.com/gitconnected/building-type-safe-websocket-applications-with-bun-and-zod-f0aef259a53e
---

> 🚀 Type-safe WebSockets for Bun! WS-Kit combines pluggable validators with clean routing, replacing messy switch statements with validated, maintainable real-time handlers.

## Introduction

In the ever-evolving world of web development, real-time interactions have become less of a luxury and more of an expectation. Whether you’re building a chat application, a collaborative document editor, or a multiplayer game, the need for bidirectional communication is clear, and WebSockets are often the technology of choice.

But let’s be honest: working with WebSockets can sometimes feel like trying to organize a party where guests randomly shout things at each other across the room. Messages fly back and forth, payload structures are inconsistent, and before you know it, your elegant application architecture looks more like a tangled ball of holiday lights that you’ve promised yourself you’ll sort out “next year.”

### Enter Bun and Zod

[Bun](https://bun.sh/) has been making waves as a fast JavaScript runtime with built-in WebSocket support that’s both performant and easy to work with. Its native WebSocket implementation (based on uWebSockets) outperforms many alternatives, making it an excellent foundation for real-time applications.

Meanwhile, [Zod](https://zod.dev/) has revolutionized runtime type validation in the JavaScript ecosystem. It provides a way to define schemas that guarantee the shape and type of your data, catching errors before they wreak havoc in your application.

### The Challenge of WebSocket Communication

When building applications with WebSockets, several challenges typically arise:

1. **Type safety across the wire**: Unlike HTTP requests with well-defined endpoints and schemas, WebSocket messages can be a wild west of untyped JSON.
2. **Message routing complexity**: As your application grows, so does the variety of messages you need to handle. Without a structured system, this often results in sprawling switch statements or complex conditionals.
3. **Error handling**: When a message doesn’t match your expectations, how do you gracefully handle it and provide meaningful feedback?
4. **Connection lifecycle management**: Who’s connected? What rooms are they in? How do you manage authentication state across a persistent connection?

### Introducing WS-Kit

To address these challenges, we've created **WS-Kit** — a type-safe WebSocket router for Bun and other platforms. It combines pluggable validators (Zod, Valibot, custom) with Bun's WebSocket implementation to create a structured, maintainable approach to real-time messaging.

At its core, **WS-Kit** gives you:

- A way to define message types with Zod schemas
- A router that automatically validates incoming messages against these schemas
- Handlers that receive only properly typed message payloads
- Built-in support for broadcasting and room-based communication
- Clean error handling patterns

Instead of wrestling with raw WebSocket messages, you can think in terms of typed routes, similar to how you'd structure a REST API. This approach brings clarity and maintainability to what would otherwise be chaotic message passing.

In this tutorial, we'll build a real-time application from the ground up using Bun and **WS-Kit**. We'll start with the basics of WebSocket communication in Bun, then gradually introduce type safety with Zod, and finally implement more advanced patterns like authentication and room-based messaging.

By the end, you’ll have a solid foundation for building robust, type-safe real-time applications that can scale with your needs. No more digging through message payloads with `console.log` at 2 AM, wondering why your users are seeing gibberish on their screens instead of the latest game state.

So grab your favorite beverage, fire up your code editor, and let’s bring some order to the WebSocket chaos. Your future self — the one who has to maintain this code six months from now — will thank you.

## Part 1: WebSockets Fundamentals in Bun

### What Are WebSockets and Why Use Them?

Remember the days of polling a server every few seconds to check for updates? Like repeatedly asking “Are we there yet?” on a road trip, except the server is the increasingly annoyed parent. That’s the world WebSockets were designed to rescue us from.

Unlike traditional HTTP connections that follow a request-response pattern, WebSockets establish a persistent, two-way communication channel between clients and servers. Once established, both sides can send messages to each other at any time without the overhead of creating new connections. This makes WebSockets perfect for:

- Real-time chat applications
- Live dashboards and data visualizations
- Multiplayer games
- Collaborative editing tools
- Notification systems
- Stock tickers and sports scores

In essence, anywhere you need low-latency, bidirectional communication, WebSockets are your friend.

### Bun’s Native WebSocket Implementation

[Bun](https://bun.sh/) comes with a blazing-fast, native WebSocket implementation built right in. No need to reach for additional packages like `ws` or `socket.io` (though they're excellent tools in their own right). Bun's implementation is:

- **Fast**: Built on top of Bun’s optimized JavaScript runtime
- **Memory-efficient**: Uses less memory than Node.js alternatives
- **Standards-compliant**: Follows the WebSocket protocol (RFC 6455)
- **Feature-rich**: Includes built-in support for the PubSub pattern

This native implementation means you can start building real-time applications immediately without any external dependencies for the WebSocket functionality itself.

### Setting Up a Basic WebSocket Server in Bun

Let’s create a simple WebSocket echo server to demonstrate how easy it is to get started with Bun. Create a new file called `server.ts`:

```typescript
import { serve } from "bun";

serve({
  port: 3000,

  fetch(req, server) {
    // Extract URL from the request
    const url = new URL(req.url);

    // Handle WebSocket upgrade requests
    if (url.pathname === "/ws") {
      // Upgrade HTTP request to WebSocket connection
      const success = server.upgrade(req);

      // Return a fallback response if upgrade fails
      if (!success) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // The connection is handled by the websocket handlers
      return undefined;
    }

    // Handle regular HTTP requests
    return new Response(
      "Hello from Bun! Try connecting to /ws with a WebSocket client.",
    );
  },

  // Define what happens when a WebSocket connects
  websocket: {
    // Called when a WebSocket connection is established
    open(ws) {
      console.log("WebSocket connection opened");
      ws.send(
        "Welcome to the echo server! Send me a message and I'll send it right back.",
      );
    },

    // Called when a message is received
    message(ws, message) {
      console.log(`Received: ${message}`);
      // Echo the message back
      ws.send(`You said: ${message}`);
    },

    // Called when the connection closes
    close(ws, code, reason) {
      console.log(`WebSocket closed with code ${code} and reason: ${reason}`);
    },

    // Called when there's an error
    error(ws, error) {
      console.error(`WebSocket error: ${error}`);
    },
  },
});

console.log("WebSocket echo server listening on ws://localhost:3000/ws");
```

To run this example:

```bash
bun run server.ts
```

## Connecting from a Browser Client

Now let’s create a simple HTML client to connect to our WebSocket server:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>WebSocket Test</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }
      #messages {
        height: 300px;
        border: 1px solid #ccc;
        margin-bottom: 10px;
        padding: 10px;
        overflow-y: auto;
      }
      #messageForm {
        display: flex;
        gap: 10px;
      }
      #messageInput {
        flex-grow: 1;
        padding: 8px;
      }
    </style>
  </head>
  <body>
    <h1>Bun WebSocket Echo Test</h1>
    <div id="status">Disconnected</div>
    <div id="messages"></div>
    <form id="messageForm">
      <input type="text" id="messageInput" placeholder="Type a message..." />
      <button type="submit">Send</button>
    </form>

    <script>
      const statusEl = document.getElementById("status");
      const messagesEl = document.getElementById("messages");
      const messageFormEl = document.getElementById("messageForm");
      const messageInputEl = document.getElementById("messageInput");

      // Create a WebSocket connection
      const socket = new WebSocket("ws://localhost:3000/ws");

      // Connection opened
      socket.addEventListener("open", (event) => {
        statusEl.textContent = "Connected";
        statusEl.style.color = "green";
        addMessage("System", "Connected to server");
      });

      // Listen for messages
      socket.addEventListener("message", (event) => {
        addMessage("Server", event.data);
      });

      // Connection closed
      socket.addEventListener("close", (event) => {
        statusEl.textContent = "Disconnected";
        statusEl.style.color = "red";
        addMessage("System", `Disconnected: Code ${event.code}`);
      });

      // Connection error
      socket.addEventListener("error", (event) => {
        statusEl.textContent = "Error";
        statusEl.style.color = "red";
        addMessage("System", "Connection error");
        console.error("WebSocket error:", event);
      });

      // Send message
      messageFormEl.addEventListener("submit", (e) => {
        e.preventDefault();
        const message = messageInputEl.value;
        if (message && socket.readyState === WebSocket.OPEN) {
          socket.send(message);
          addMessage("You", message);
          messageInputEl.value = "";
        }
      });

      // Helper to add message to the UI
      function addMessage(sender, content) {
        const messageEl = document.createElement("div");
        messageEl.innerHTML = `<strong>${sender}:</strong> ${content}`;
        messagesEl.appendChild(messageEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    </script>
  </body>
</html>
```

Open this HTML file in a browser, and you should be able to send messages to your Bun WebSocket server and see the echoed responses.

## Understanding the WebSocket Lifecycle

WebSockets follow a specific lifecycle:

1. **Connection** — The client initiates a handshake by sending an HTTP request with an `Upgrade: websocket` header. If the server accepts, it responds with a `101 Switching Protocols` status.
2. **Open** — After a successful handshake, the WebSocket connection is established and the `open` event fires.
3. **Message Exchange** — Both client and server can send messages at any time.
4. **Closing** — Either side can initiate closing the connection with a close code and reason.
5. **Closed** — The connection is terminated. No more messages can be sent.

## The Challenge of Raw WebSocket Messages

While our echo server is simple, real applications quickly become more complex. As soon as you start building a non-trivial application, you’ll encounter challenges:

1. **Message Format**: Should you use JSON? Binary? Some custom format?
2. **Message Types**: How do you distinguish between different kinds of messages?
3. **Routing Logic**: How do you direct messages to the appropriate handlers?
4. **Error Handling**: What happens when a message isn’t formatted correctly?

Let’s upgrade our example to handle JSON messages with a `type` field:

```typescript
import { serve } from "bun";

type ChatMessage = {
  type: string;
  content?: any;
};

serve({
  port: 3000,

  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const success = server.upgrade(req);
      return success
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    }
    return new Response("Hello from Bun!");
  },

  websocket: {
    open(ws) {
      console.log("Connection opened");
    },

    message(ws, data) {
      try {
        // Parse the incoming message
        const message = JSON.parse(data as string) as ChatMessage;

        // Handle different message types
        switch (message.type) {
          case "CHAT":
            console.log(`Chat message: ${message.content.text}`);
            // Echo back with a timestamp
            ws.send(
              JSON.stringify({
                type: "CHAT_ECHO",
                content: {
                  original: message.content.text,
                  timestamp: new Date().toISOString(),
                },
              }),
            );
            break;

          case "PING":
            ws.send(
              JSON.stringify({
                type: "PONG",
                content: { timestamp: new Date().toISOString() },
              }),
            );
            break;

          default:
            ws.send(
              JSON.stringify({
                type: "ERROR",
                content: { message: `Unknown message type: ${message.type}` },
              }),
            );
            break;
        }
      } catch (error) {
        console.error("Error processing message:", error);
        ws.send(
          JSON.stringify({
            type: "ERROR",
            content: { message: "Could not parse message" },
          }),
        );
      }
    },

    close(ws, code, reason) {
      console.log(`Connection closed: ${code} ${reason}`);
    },
  },
});

console.log("Improved WebSocket server running on ws://localhost:3000/ws");
```

### The Problem with This Approach

Even in this simple example, we’re already seeing issues:

1. **Type Safety**: The `as ChatMessage` cast doesn't guarantee the message actually has the right structure.
2. **Error Prone**: It’s easy to typo a message type or forget a field.
3. **Scaling Issues**: As you add more message types, the switch statement becomes unwieldy.
4. **Maintenance Burden**: There’s no centralized definition of message structures.

This is where **WS-Kit** comes in, providing a structured approach to handling WebSocket messages with pluggable validators. It turns our messy switch statement into clear, type-safe routes with validation baked in.

In the next section, we'll explore how to solve these problems using **WS-Kit** with Zod schemas for type-safety.

## Part 2: The Type-Safety Challenge

### The Wild West of WebSocket Messages

If you’ve been following along, you now have a basic WebSocket server running in Bun. Messages are flying back and forth, connections are being established and closed — everything seems great! But then you try to build something real, and suddenly it feels like you’re trying to herd cats in the dark. With a blindfold on. While riding a unicycle.

The challenge with WebSocket communication is that, unlike REST APIs with their well-defined endpoints and request/response structures, WebSockets are essentially a continuous stream of messages. There’s no built-in mechanism to ensure that:

1. Messages have the right structure
2. Required fields are present
3. Values have the correct types
4. Handlers receive only messages they’re designed to process

This is where many WebSocket applications start to crumble under their own complexity. Let’s explore the key challenges in detail.

### The “What Did I Just Receive?” Problem

Take a look at this common WebSocket message handler pattern:

```javascript
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "chat_message") {
    // Is data.content defined? Is it a string? Who knows!
    chatSystem.processMessage(data.content);
  } else if (data.type === "user_joined") {
    // Does data.userId exist? Is it a number or string?
    notifyUserJoined(data.userId);
  } else if (data.type === "typing_indicator") {
    // Is data.isTyping a boolean or something else?
    updateTypingStatus(data.userId, data.isTyping);
  }
  // And so on...
});
```

This approach has several issues:

1. **No guarantee of structure**: Just because `data.type` is `'chat_message'` doesn't mean `data.content` exists.
2. **Type coercion traps**: JavaScript’s loose typing means `data.isTyping` could be the string `"false"` instead of the boolean `false`.
3. **Typo landmines**: Mistype `'chat_message'` as `'chat_mesage'` and your handler won't trigger.
4. **Implicit dependencies**: It’s not clear what fields each message type requires.

### The Evolution of Error Messages

As your application grows, so does the sophistication (or desperation) of your error handling:

**Stage 1: Blissful Ignorance**

```javascript
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  processChatMessage(data.room, data.text); // What could go wrong?
});
```

**Stage 2: The Console.log Debugging Phase**

```javascript
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  console.log("Received:", data); // Let me see what I'm dealing with
  if (data.room && data.text) {
    processChatMessage(data.room, data.text);
  }
});
```

**Stage 3: Trust Issues**

```javascript
ws.addEventListener("message", (event) => {
  try {
    const data = JSON.parse(event.data);
    if (!data || typeof data !== "object") {
      throw new Error("Invalid message format");
    }

    if (!data.type || typeof data.type !== "string") {
      throw new Error("Missing or invalid type field");
    }

    if (data.type === "chat_message") {
      if (!data.room || typeof data.room !== "string") {
        throw new Error("Missing or invalid room field");
      }

      if (!data.text || typeof data.text !== "string") {
        throw new Error("Missing or invalid text field");
      }

      processChatMessage(data.room, data.text);
    }
    // And so on for EVERY message type...
  } catch (error) {
    console.error("Error processing message:", error);
    ws.send(
      JSON.stringify({
        type: "error",
        message: error.message,
      }),
    );
  }
});
```

By Stage 3, a third of your codebase is dedicated to validation, and you’re seriously considering a career change to something less frustrating… like herding actual cats.

### The TypeScript Mirage

“But wait,” you might say, “I’m using TypeScript! I’ve defined interfaces for all my message types!”

```typescript
interface BaseChatMessage {
  type: string;
}

interface ChatMessage extends BaseChatMessage {
  type: 'chat_message';
  room: string;
  text: string;
}

interface UserJoinedMessage extends BaseChatMessage {
  type: 'user_joined';
  userId: string;
  username: string;
}

// More message types...

type AllMessageTypes = ChatMessage | UserJoinedMessage | /* ... */;

ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data) as AllMessageTypes; // The infamous "trust me" cast

  switch (data.type) {
    case 'chat_message':
      // TypeScript now thinks data is ChatMessage
      processChatMessage(data.room, data.text);
      break;
    case 'user_joined':
      // TypeScript now thinks data is UserJoinedMessage
      notifyUserJoined(data.userId, data.username);
      break;
  }
});
```

This looks better! TypeScript gives you nice autocomplete and seems to understand your message structure. But there’s an illusion at play here: that `as AllMessageTypes` cast is basically you telling TypeScript, "Trust me, this JSON is properly formatted." But at runtime, all those lovely types disappear, and you're back to the Wild West.

What if someone sends this?

```json
{
  "type": "chat_message",
  "rum": "general", // Typo: "rum" instead of "room"
  "text": "Hello world!"
}
```

TypeScript won’t save you. Your code will try to process `data.room`, which is `undefined`, potentially causing errors downstream.

### The Runtime Validation Gap

The core issue is the gap between compile-time types (what TypeScript checks) and runtime values (what actually arrives over the wire). This is where validation libraries like Zod come in.

Zod lets you define schemas that serve as both TypeScript types AND runtime validators:

```typescript
import { z } from "zod";

// Define message schemas
const ChatMessageSchema = z.object({
  type: z.literal("chat_message"),
  room: z.string(),
  text: z.string(),
});

const UserJoinedSchema = z.object({
  type: z.literal("user_joined"),
  userId: z.string(),
  username: z.string(),
});

// Infer TypeScript types from schemas
type ChatMessage = z.infer<typeof ChatMessageSchema>;
type UserJoinedMessage = z.infer<typeof UserJoinedSchema>;

// Use in handler
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  try {
    if (data.type === "chat_message") {
      const validatedData = ChatMessageSchema.parse(data);
      processChatMessage(validatedData.room, validatedData.text);
    } else if (data.type === "user_joined") {
      const validatedData = UserJoinedSchema.parse(data);
      notifyUserJoined(validatedData.userId, validatedData.username);
    }
  } catch (error) {
    console.error("Validation error:", error);
    // Send error back to client
  }
});
```

This is much more robust! Now if someone sends a malformed message, Zod will catch it and provide detailed error information.

### The Routing Challenge

But we still have another problem: as your application grows, this giant message handler becomes unmaintainable. You need a way to:

1. Define message types and their validation schemas in one place
2. Route incoming messages to the appropriate handlers
3. Handle error cases consistently
4. Provide type safety throughout the process

This is where **WS-Kit** comes in. It combines message type definition, validation, and routing into a clean, type-safe API.

## Enter WS-Kit

**WS-Kit** is designed to solve these challenges by providing:

1. A way to define message types with Zod schemas
2. Automatic validation of incoming messages
3. Routing to type-specific handlers
4. Clean error handling patterns

All code examples in this guide use `createRouter` imported from `@ws-kit/zod`, which automatically configures the router with Zod validation. This is the recommended way to set up WS-Kit.

Instead of a giant switch statement or if/else chain, you can write code like this:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// Define message types with schemas
const ChatMessage = message("CHAT_MESSAGE", {
  room: z.string(),
  text: z.string(),
});

const JoinRoom = message("JOIN_ROOM", {
  room: z.string(),
});

// Create router
const router = createRouter();

// Define handlers for each message type
router.on(ChatMessage, (ctx) => {
  // ctx.payload is fully typed and validated!
  const { room, text } = ctx.payload;

  // Do something with the message
  console.log(`Message in ${room}: ${text}`);

  // Send response
  ctx.send(ChatMessage, { room, text: "Echo: " + text });
});

router.on(JoinRoom, async (ctx) => {
  const { room } = ctx.payload;
  await ctx.topics.subscribe(room); // Subscribe to room using Bun's built-in PubSub
  console.log(`Client joined room: ${room}`);
});

// Start server with router
serve(router, {
  port: 3000,
});
```

With this approach:

1. Message schemas are defined clearly in one place
2. Incoming messages are automatically validated
3. Handlers only receive messages they’re supposed to handle
4. TypeScript provides full type safety at every step
5. Invalid messages generate helpful error responses

### The Benefits of Type-Safe WebSockets

Using a typed approach with validation provides several key benefits:

1. **Robust error handling**: Catch malformed messages early with detailed error information
2. **Self-documenting code**: Your message schemas serve as documentation for your protocol
3. **IDE support**: Get autocomplete and type checking as you work with messages
4. **Safer refactoring**: Change message structures with confidence, as TypeScript will find usages
5. **Clearer mental model**: Discrete message types make the system easier to understand

### From Chaos to Order

With a type-safe approach using **WS-Kit** and Zod, we've moved from the Wild West of WebSocket messages to a structured, maintainable system. No more casting and hoping for the best. No more giant switch statements. No more manual validation code.

In the next section, we'll dive deeper into **WS-Kit** and explore how it can be used to build a complete real-time chat application with authentication, rooms, and more.

## Part 3: Introducing WS-Kit

### The Missing Piece in WebSocket Development

In the previous sections, we explored WebSockets in Bun and the challenges of maintaining type safety in a real-time messaging environment. Now it's time to introduce the solution to our WebSocket woes: **WS-Kit**.

Think of **WS-Kit** as that friend who always keeps their kitchen organized—the one who has separate containers for different types of pasta and labels everything. Maybe a bit obsessive, but you're secretly grateful when you need to find the rigatoni at 2 AM. That's what **WS-Kit** does for your WebSocket messages: it keeps everything organized, labeled, and exactly where it should be.

### What is WS-Kit?

**WS-Kit** is a lightweight, type-safe WebSocket router for Bun and other platforms. It provides a structured way to handle WebSocket connections and route messages to different handlers based on message types, all with full TypeScript support and pluggable validator integration (Zod, Valibot, custom).

Instead of building your own message routing system from scratch (and let's be honest, the first version would probably be a giant switch statement), **WS-Kit** gives you a battle-tested solution that's ready to use.

## Core Philosophy

The core philosophy behind **WS-Kit** is simple:

1. **Pluggable, not prescriptive**: Work with any validator (Zod, Valibot, custom) and any platform (Bun, Cloudflare, custom adapters)
2. **Type safety everywhere**: From message definition to handler execution
3. **Runtime validation**: Catch errors before they cause problems
4. **Clean separation**: Organize handlers by message type
5. **Minimal overhead**: Keep things fast and lightweight

### Key Features in Detail

Let's dig into the key features that make **WS-Kit** stand out:

### Type-Safe Messaging with Zod Schemas

At the heart of **WS-Kit** is the `message` function. This function allows you to define message types with their associated payloads using Zod schemas:

```typescript
import { z, message } from "@ws-kit/zod";

// Define a message type for joining a chat room
export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
});

// Define a message for sending a chat message
export const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  message: z.string().min(1).max(500), // Add constraints
  attachments: z
    .array(
      z.object({
        type: z.enum(["image", "file"]),
        url: z.string().url(),
      }),
    )
    .optional(),
});
```

The magic here is twofold:

1. **TypeScript Types**: The `message` function automatically generates TypeScript types that you can use throughout your codebase
2. **Runtime Validation**: When a message arrives, it's automatically validated against the schema before your handler is called

This means you can confidently access `ctx.payload.roomId` in your handler, knowing it's a string that passed validation. No more defensive coding with `if (typeof data.roomId === 'string')` checks everywhere!

### Intuitive Routing System

With **WS-Kit**, you define handlers for specific message types:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { JoinRoom, SendMessage } from "./schemas";

const router = createRouter();

// Handle JOIN_ROOM messages
router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload; // Fully typed and validated!
  console.log(`Client wants to join room: ${roomId}`);

  // Join the room using Bun's built-in PubSub
  await ctx.topics.subscribe(roomId);

  // Send confirmation
  ctx.send(JoinRoom, { roomId }); // Type-checked!
});

// Handle SEND_MESSAGE messages
router.on(SendMessage, (ctx) => {
  const { roomId, message, attachments } = ctx.payload;
  console.log(`New message in ${roomId}: ${message}`);

  // No need to check if attachments exists - type system handles it
  const hasAttachments = attachments && attachments.length > 0;

  // Broadcast to room (using Bun's built-in PubSub)
  // More on this in the broadcast section
});
```

Each handler receives a context object with:

- `ws`: The WebSocket connection
- `payload`: The validated message payload (fully typed!)
- `meta`: Additional metadata about the message
- `send()`: A helper method for sending responses

If a message arrives with an unknown type or fails validation, it's automatically rejected with an appropriate error message — no need to write that boilerplate yourself.

## Leveraging Bun's Native WebSocket Performance

**WS-Kit** is designed to be a thin layer on top of Bun's already-fast WebSocket implementation. It doesn't reinvent the wheel—it just adds guardrails to keep you on the road.

The library adds minimal overhead to message processing, focusing on routing and validation while letting Bun handle the heavy lifting of WebSocket connections, frame parsing, and PubSub functionality.

## Flexible Integration

One of the strengths of **WS-Kit** is how easily it integrates with different server setups:

```typescript
import { createRouter, z } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";

// WebSocket router
const router = createRouter();

// Define your message handlers here
router.on(YourMessage, (ctx) => {
  // Handle message
});

// High-level serve() with auto-configuration
serve(router, {
  port: 3000,
});

// Or for advanced setups, use Hono or any HTTP framework:
import { Hono } from "hono";
import { createBunHandler } from "@ws-kit/bun";

const app = new Hono();
app.get("/", (c) => c.text("Welcome to Hono!"));

const wsHandler = createBunHandler(router);

Bun.serve({
  port: 3000,
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      return wsHandler(req, server);
    }
    return app.fetch(req);
  },
  websocket: router.websocket,
});
```

The library is framework-agnostic — it works standalone, with Hono, Elysia, or any other HTTP framework you prefer.

### Connection Lifecycle Management

**WS-Kit** provides handlers for the entire WebSocket lifecycle:

```typescript
// Handle new connections
router.onOpen((ctx) => {
  console.log(`New client connected: ${ctx.data.clientId}`);

  // Send welcome message
  ctx.send(Welcome, { message: "Welcome to the server!" });
});

// Handle message types (as seen earlier)
router.on(JoinRoom, (ctx) => {
  /* ... */
});

// Handle disconnections
router.onClose((ctx) => {
  console.log(`Client disconnected: ${ctx.data.clientId}`);
  console.log(`Close code: ${ctx.code}`);
  console.log(`Close reason: ${ctx.reason}`);

  // Clean up any resources
  if (ctx.data.roomId) {
    leaveRoom(ctx.data.roomId, ctx.data.clientId);
  }
});
```

Each handler has access to the WebSocket connection's metadata through `ctx.data`, allowing you to store and retrieve session information.

## Authentication and Security

Security is a critical concern in WebSocket applications. **WS-Kit** provides a clean way to handle authentication during the WebSocket upgrade process:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { verifyToken } from "./auth"; // Your authentication logic

type AppData = {
  userId?: string;
  userRole?: string;
};

// Create router with type for connection metadata
const router = createRouter<AppData>();

// Your message handlers
router.on(SomeMessage, (ctx) => {
  // ctx.data.userId is available here
});

// Start server with authentication
serve(router, {
  port: 3000,
  async authenticate(req) {
    // Extract and verify authentication token
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.split("Bearer ")[1];

    // Optional: Reject connection if no token
    if (!token) {
      return undefined; // Rejects the connection
    }

    // Verify token and get user info
    const user = await verifyToken(token);

    // Return user data to be attached to ws.data
    return {
      userId: user?.id,
      userRole: user?.role,
    };
  },
});
```

By authenticating during the upgrade process, you ensure that only authorized users can establish WebSocket connections. The user data is then available in all your handlers via `ctx.data`.

## Broadcasting and Room Management

WebSocket applications often need to broadcast messages to multiple clients. **WS-Kit** complements Bun's built-in PubSub functionality with schema validation:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { ChatMessage, UserJoined } from "./schemas";

const router = createRouter();

router.on(ChatMessage, (ctx) => {
  const { roomId, message } = ctx.payload;
  const userId = ctx.data.userId;

  // Broadcast the message to everyone in the room
  ctx.publish(roomId, ChatMessage, {
    roomId,
    userId,
    message,
    timestamp: Date.now(),
  });
});

router.on(JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.data.userId;

  // Subscribe to the room
  await ctx.topics.subscribe(roomId);
  ctx.data.roomId = roomId;

  // Notify others
  ctx.publish(roomId, UserJoined, {
    roomId,
    userId,
    timestamp: Date.now(),
  });
});
```

The `ctx.publish()` helper ensures that broadcast messages are validated against their schemas before being sent, providing the same type safety for broadcasts that you get with direct messaging.

### Error Handling

Robust error handling is crucial for WebSocket applications. **WS-Kit** includes a standardized error system with error codes aligned with gRPC:

```typescript
import { z, createRouter } from "@ws-kit/zod";

const router = createRouter();

router.on(JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;

  // Check if room exists
  const roomExists = checkRoomExists(roomId);

  if (!roomExists) {
    // Send typed error response
    ctx.error("NOT_FOUND", `Room ${roomId} does not exist`, {
      roomId, // Additional debug info
    });
    return;
  }

  // Continue with normal flow...
});
```

The library includes predefined error codes (UNAUTHENTICATED, PERMISSION_DENIED, INVALID_ARGUMENT, NOT_FOUND, RESOURCE_EXHAUSTED, etc.) for common scenarios, ensuring consistent error reporting.

### Modular Route Organization

As your application grows, you can organize routes into separate modules:

```typescript
// chat.ts
import { z, createRouter } from "@ws-kit/zod";
import { ChatMessage, JoinRoom } from "./schemas";

// Create a router instance
export const chatRouter = createRouter();

// Add message handlers
chatRouter.on(ChatMessage, (ctx) => {
  /* ... */
});
chatRouter.on(JoinRoom, (ctx) => {
  /* ... */
});

// main.ts
import { z, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import { chatRouter } from "./chat";
import { userRouter } from "./user";

const router = createRouter();

// Add modular routers
router.merge(chatRouter);
router.merge(userRouter);

// Start server
serve(router, { port: 3000 });
```

This keeps your codebase organized and makes it easier to collaborate with team members.

### Why Choose WS-Kit?

With so many WebSocket solutions out there, why choose **WS-Kit**?

1. **Platform-agnostic**: Pluggable adapters for Bun, Cloudflare, and custom platforms
2. **Validator-agnostic**: Works with Zod, Valibot, or your own validation library
3. **TypeScript-first**: Designed with type safety as a core principle
4. **Runtime validation**: Catch errors before they cause problems
5. **Lightweight**: Minimal overhead, just the features you need
6. **Progressive**: Start simple and scale as needed

It's the Goldilocks of WebSocket libraries: not too heavy, not too bare-bones, but just right. Plus, you're not locked into a single validator or platform.

### Getting Started with WS-Kit

Ready to bring some order to your WebSocket chaos? Let's get started:

```bash
bun add @ws-kit/zod @ws-kit/bun zod
bun add @types/bun -D  # For TypeScript support
```

In the next section, we'll put everything together to build a complete real-time chat application using **WS-Kit**, demonstrating how the library makes complex WebSocket applications more manageable.

Say goodbye to giant switch statements and untyped message payloads. With **WS-Kit**, your WebSocket code can be as clean and organized as that friend's pasta collection—just hopefully without the late-night carbohydrate cravings.

## Part 4: Building a Real-Time Chat Application

Now that we understand the fundamentals of WebSockets in Bun and have been introduced to **WS-Kit**, let's put everything together to build something practical: a real-time chat application.

After all, what better way to test our new WebSocket routing superpowers than by creating yet another chat app? Because clearly, what the world needs is one more place for people to share cat memes and debate whether pineapple belongs on pizza (it does, fight me).

### Project Setup

First things first, let's set up our project. Create a new folder for our chat application and initialize it:

```bash
mkdir bun-chat-app
cd bun-chat-app
bun init -y
```

Next, install the dependencies we'll need:

```bash
bun add @ws-kit/zod @ws-kit/bun zod
bun add @types/bun -D
```

### Step 1: Define Our Message Schemas

The heart of our type-safe approach is defining clear message schemas. Let's create a file called `schemas.ts` to define all the message types our chat application will support:

```typescript
import { z, message } from "@ws-kit/zod";

// User authentication
export const Authenticate = message("AUTHENTICATE", {
  token: z.string(),
});

export const AuthSuccess = message("AUTH_SUCCESS", {
  userId: z.string(),
  username: z.string(),
});

// Room management
export const JoinRoom = message("JOIN_ROOM", {
  roomId: z.string(),
});

export const LeaveRoom = message("LEAVE_ROOM", {
  roomId: z.string(),
});

export const UserJoined = message("USER_JOINED", {
  roomId: z.string(),
  userId: z.string(),
  username: z.string(),
});

export const UserLeft = message("USER_LEFT", {
  roomId: z.string(),
  userId: z.string(),
  username: z.string(),
});

export const RoomList = message("ROOM_LIST", {
  rooms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      userCount: z.number(),
    }),
  ),
});

// Messaging
export const SendMessage = message("SEND_MESSAGE", {
  roomId: z.string(),
  text: z.string().min(1).max(1000),
  // Optional attachment
  attachment: z
    .object({
      type: z.enum(["image", "file"]),
      url: z.string().url(),
      name: z.string().optional(),
    })
    .optional(),
});

export const ChatMessage = message("CHAT_MESSAGE", {
  messageId: z.string(),
  roomId: z.string(),
  userId: z.string(),
  username: z.string(),
  text: z.string(),
  timestamp: z.number(),
  attachment: z
    .object({
      type: z.enum(["image", "file"]),
      url: z.string().url(),
      name: z.string().optional(),
    })
    .optional(),
});

// Typing indicators
export const TypingStart = message("TYPING_START", {
  roomId: z.string(),
});

export const TypingStop = message("TYPING_STOP", {
  roomId: z.string(),
});

export const UserTyping = message("USER_TYPING", {
  roomId: z.string(),
  userId: z.string(),
  username: z.string(),
});

// Connection metadata type
export type Meta = {
  userId?: string;
  username?: string;
  currentRoomId?: string;
  isAuthenticated?: boolean;
};
```

Notice how we’ve organized our messages into logical groups: authentication, room management, messaging, and typing indicators. We’re also using Zod’s validation capabilities to ensure messages have the correct shape and content (like enforcing minimum and maximum message length).

### Step 2: Setting Up Our Mock User Database

For simplicity, we’ll use an in-memory store for users and rooms instead of a real database:

```typescript
import { randomUUID } from "crypto";

// User record
export type User = {
  id: string;
  username: string;
  token: string;
};

// Room record
export type Room = {
  id: string;
  name: string;
  users: Set<string>; // User IDs
};

// In-memory storage
const users = new Map<string, User>();
const tokens = new Map<string, string>(); // token -> userId
const rooms = new Map<string, Room>();

// Seed with some default rooms
rooms.set("general", {
  id: "general",
  name: "General Chat",
  users: new Set(),
});

rooms.set("random", {
  id: "random",
  name: "Random Stuff",
  users: new Set(),
});

// User authentication methods
export function authenticateUser(token: string): User | null {
  const userId = tokens.get(token);
  if (!userId) return null;

  return users.get(userId) || null;
}

export function createUser(username: string): User {
  const id = randomUUID();
  const token = randomUUID();

  const user: User = { id, username, token };
  users.set(id, user);
  tokens.set(token, id);

  return user;
}

// Room methods
export function getRooms(): Room[] {
  return Array.from(rooms.values());
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function joinRoom(roomId: string, userId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;

  room.users.add(userId);
  return true;
}

export function leaveRoom(roomId: string, userId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;

  return room.users.delete(userId);
}

export function getUser(userId: string): User | undefined {
  return users.get(userId);
}
```

This simple store handles user authentication, room management, and keeping track of who’s in which room.

### Step 3: Implementing Our WebSocket Handlers

Now let's implement handlers for each of our message types. Let's create a file called `chat-router.ts`:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { randomUUID } from "crypto";
import * as schema from "./schemas";
import {
  authenticateUser,
  createUser,
  getRoom,
  getRooms,
  joinRoom,
  leaveRoom,
  getUser,
} from "./data-store";

// Create a router with our meta type
const router = createRouter<schema.Meta>();

// Handle new connections
router.onOpen((ctx) => {
  // clientId is automatically assigned by ws-kit framework
  console.log(`New client connected: ${ctx.data.clientId}`);

  // Assign a random guest name until authenticated
  ctx.assignData({
    username: `Guest-${Math.floor(Math.random() * 10000)}`,
  });

  // Send room list to the new client
  const rooms = getRooms().map((room) => ({
    id: room.id,
    name: room.name,
    userCount: room.users.size,
  }));

  ctx.send(schema.RoomList, { rooms });
});

// Handle authentication
router.on(schema.Authenticate, (ctx) => {
  const { token } = ctx.payload;

  // Check if token exists in our store
  const user = authenticateUser(token);

  if (user) {
    // Authentication successful
    ctx.data.isAuthenticated = true;
    ctx.data.userId = user.id;
    ctx.data.username = user.username;

    ctx.send(schema.AuthSuccess, {
      userId: user.id,
      username: user.username,
    });

    console.log(`User authenticated: ${user.username} (${user.id})`);
  } else {
    // Create a new user if token doesn't exist
    // In a real app, you'd probably reject invalid tokens
    const newUser = createUser(
      ctx.data.username || `User-${randomUUID().slice(0, 6)}`,
    );

    ctx.data.isAuthenticated = true;
    ctx.data.userId = newUser.id;
    ctx.data.username = newUser.username;

    ctx.send(schema.AuthSuccess, {
      userId: newUser.id,
      username: newUser.username,
    });

    console.log(`New user created: ${newUser.username} (${newUser.id})`);
  }
});

// Handle joining a room
router.on(schema.JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.data.userId;
  const username = ctx.data.username;

  // Check if user is authenticated
  if (!userId || !username) {
    ctx.error("UNAUTHENTICATED", "You must be authenticated to join a room");
    return;
  }

  // Check if room exists
  const room = getRoom(roomId);
  if (!room) {
    ctx.error("NOT_FOUND", `Room ${roomId} does not exist`);
    return;
  }

  // If user is already in a room, leave it first
  if (ctx.data.currentRoomId) {
    leaveRoom(ctx.data.currentRoomId, userId);

    // Let others know user left the previous room
    ctx.publish(ctx.data.currentRoomId, schema.UserLeft, {
      roomId: ctx.data.currentRoomId,
      userId,
      username,
    });

    // Unsubscribe from previous room
    await ctx.topics.unsubscribe(ctx.data.currentRoomId);
  }

  // Join the new room
  joinRoom(roomId, userId);
  ctx.data.currentRoomId = roomId;

  // Subscribe to the room's messages
  await ctx.topics.subscribe(roomId);

  // Confirm to the user they've joined
  ctx.send(schema.UserJoined, {
    roomId,
    userId,
    username,
  });

  // Let others know a new user joined
  ctx.publish(roomId, schema.UserJoined, {
    roomId,
    userId,
    username,
  });

  console.log(`User ${username} (${userId}) joined room: ${roomId}`);
});

// Handle leaving a room
router.on(schema.LeaveRoom, async (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.data.userId;
  const username = ctx.data.username;

  if (!userId || !username) {
    ctx.error("UNAUTHENTICATED", "You must be authenticated to leave a room");
    return;
  }

  // Check if user is in the room
  if (ctx.data.currentRoomId !== roomId) {
    ctx.error("INVALID_ARGUMENT", "You are not in this room");
    return;
  }

  // Leave the room
  leaveRoom(roomId, userId);
  ctx.data.currentRoomId = undefined;

  // Unsubscribe from room
  await ctx.topics.unsubscribe(roomId);

  // Let others know user left
  ctx.publish(roomId, schema.UserLeft, {
    roomId,
    userId,
    username,
  });

  console.log(`User ${username} (${userId}) left room: ${roomId}`);
});

// Handle sending messages
router.on(schema.SendMessage, (ctx) => {
  const { roomId, text, attachment } = ctx.payload;
  const userId = ctx.data.userId;
  const username = ctx.data.username;

  if (!userId || !username) {
    ctx.error("UNAUTHENTICATED", "You must be authenticated to send messages");
    return;
  }

  // Check if room exists
  if (!getRoom(roomId)) {
    ctx.error("NOT_FOUND", `Room ${roomId} does not exist`);
    return;
  }

  // Check if user is in the room they're trying to message
  if (ctx.data.currentRoomId !== roomId) {
    ctx.error(
      "PERMISSION_DENIED",
      "You must join the room before sending messages",
    );
    return;
  }

  // Create a message object with ID and timestamp
  const messageId = randomUUID();
  const timestamp = Date.now();

  const chatMessage = {
    messageId,
    roomId,
    userId,
    username,
    text,
    timestamp,
    attachment,
  };

  // Broadcast the message to everyone in the room, including sender
  ctx.publish(roomId, schema.ChatMessage, chatMessage);

  console.log(
    `Message sent to room ${roomId} by ${username}: ${text.substring(0, 20)}${text.length > 20 ? "..." : ""}`,
  );
});

// Handle typing indicators
router.on(schema.TypingStart, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.data.userId;
  const username = ctx.data.username;

  if (!userId || !username || ctx.data.currentRoomId !== roomId) return;

  // Broadcast typing indicator to everyone else in the room
  ctx.publish(roomId, schema.UserTyping, {
    roomId,
    userId,
    username,
  });
});

// Handle connection closure
router.onClose((ctx) => {
  const userId = ctx.data.userId;
  const username = ctx.data.username;
  const roomId = ctx.data.currentRoomId;

  console.log(
    `Client disconnected: ${userId || ctx.data.clientId}, code: ${ctx.code}`,
  );

  // If user was in a room, notify others and clean up
  if (userId && username && roomId) {
    leaveRoom(roomId, userId);

    // Let others know user left
    ctx.publish(roomId, schema.UserLeft, {
      roomId,
      userId,
      username,
    });
  }
});

export default router;
```

That’s quite a bit of code, but it’s well-organized and each message type has its own dedicated handler. The beauty of this approach is that each handler receives a fully typed and validated payload, making it easy to work with the data without worrying about runtime errors.

### Step 4: Creating the Main Server

Now let's create the main server file that will bring everything together:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import chatRouter from "./chat-router";

// Create the main WebSocket router
const router = createRouter<schema.Meta>();

// Add our chat routes
router.merge(chatRouter);

// Start the server with WS-Kit
serve(router, {
  port: 3000,
});

console.log("Chat server running on http://localhost:3000");
console.log("WebSocket endpoint: ws://localhost:3000/ws");
```

## Step 5: Creating a Simple Frontend with @ws-kit/client

Let's create a basic chat UI and use the `@ws-kit/client` SDK for WebSocket communication. This dramatically simplifies the client-side code compared to manual WebSocket handling.

First, install the client SDK:

```bash
npm install @ws-kit/client
```

> **Note:** The `@ws-kit/client` package provides the complete client SDK with full TypeScript support. Import from `@ws-kit/client/zod` for Zod-based validation or `@ws-kit/client/valibot` for Valibot-based validation, matching your server-side validator choice.

Create a `public` folder for our static files:

```bash
mkdir -p public
```

Create the HTML file:

```html
<!-- filepath: public/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bun Chat App</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div class="app-container">
      <div class="sidebar">
        <div class="user-info">
          <span id="username">Not logged in</span>
          <button id="login-btn">Login</button>
        </div>
        <div id="connection-status" class="connection-status">Disconnected</div>
        <h3>Rooms</h3>
        <ul id="room-list" class="room-list"></ul>
      </div>

      <div class="chat-container">
        <div id="room-header" class="room-header">Select a room</div>

        <div id="messages" class="messages"></div>

        <div id="typing-indicator" class="typing-indicator"></div>

        <form id="message-form" class="message-form">
          <input
            type="text"
            id="message-input"
            placeholder="Type a message..."
            disabled
          />
          <button type="submit" id="send-btn" disabled>Send</button>
        </form>
      </div>
    </div>

    <script src="app.js" type="module"></script>
  </body>
</html>
```

Add styling (same as before, with one addition for connection status):

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Oxygen,
    Ubuntu,
    Cantarell,
    "Open Sans",
    "Helvetica Neue",
    sans-serif;
}

body {
  background-color: #f5f5f5;
}

.app-container {
  display: flex;
  height: 100vh;
  max-width: 1200px;
  margin: 0 auto;
  background-color: white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
}

.sidebar {
  width: 250px;
  background-color: #f0f0f0;
  padding: 20px;
  border-right: 1px solid #ddd;
}

.user-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ddd;
}

.connection-status {
  font-size: 0.85em;
  padding: 8px;
  margin-bottom: 15px;
  border-radius: 4px;
  text-align: center;
  background-color: #ffe6e6;
  color: #d32f2f;
}

.connection-status.open {
  background-color: #e6ffe6;
  color: #388e3c;
}

.connection-status.connecting {
  background-color: #fff3e0;
  color: #f57c00;
}

.room-list {
  list-style: none;
}

.room-item {
  padding: 8px 10px;
  margin-bottom: 5px;
  border-radius: 4px;
  cursor: pointer;
}

.room-item:hover {
  background-color: #e0e0e0;
}

.room-item.active {
  background-color: #2c3e50;
  color: white;
}

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.room-header {
  padding: 15px 20px;
  background-color: #2c3e50;
  color: white;
  font-weight: bold;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.message {
  margin-bottom: 15px;
}

.message .header {
  display: flex;
  margin-bottom: 5px;
}

.message .username {
  font-weight: bold;
  margin-right: 10px;
}

.message .time {
  color: #999;
  font-size: 0.8em;
}

.message .text {
  background-color: #f1f1f1;
  padding: 10px;
  border-radius: 10px;
  max-width: 80%;
  word-break: break-word;
}

.message.own {
  text-align: right;
}

.message.own .text {
  background-color: #3498db;
  color: white;
  margin-left: auto;
}

.message.system {
  text-align: center;
  font-style: italic;
  color: #666;
  margin: 10px 0;
}

.typing-indicator {
  padding: 5px 20px;
  color: #666;
  font-style: italic;
  min-height: 30px;
}

.message-form {
  display: flex;
  padding: 10px 20px;
  background-color: #f9f9f9;
  border-top: 1px solid #ddd;
}

.message-form input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-right: 10px;
}

.message-form button {
  padding: 10px 15px;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.message-form button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}
```

Now, here's the client code using `@ws-kit/client` (much simpler than manual WebSocket handling):

```javascript
// app.js
import { wsClient } from "@ws-kit/client/zod";
import {
  Authenticate,
  AuthSuccess,
  JoinRoom,
  UserJoined,
  UserLeft,
  ChatMessage,
  SendMessage,
  RoomList,
  TypingStart,
  UserTyping,
} from "./shared/schemas.js";

// DOM elements
const usernameElement = document.getElementById("username");
const loginButton = document.getElementById("login-btn");
const roomList = document.getElementById("room-list");
const roomHeader = document.getElementById("room-header");
const messagesContainer = document.getElementById("messages");
const typingIndicator = document.getElementById("typing-indicator");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-btn");
const connectionStatus = document.getElementById("connection-status");

// App state
let currentUser = {
  userId: null,
  username: null,
};
let currentRoomId = null;
let rooms = [];

// Create the WebSocket client with auto-reconnection
const client = wsClient({
  url: `ws://${window.location.host}/ws`,
  autoConnect: true,
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    initialDelayMs: 300,
    maxDelayMs: 10_000,
    jitter: "full",
  },
  auth: {
    getToken: () => localStorage.getItem("chatToken"),
    attach: "query",
  },
});

// Monitor connection state
client.onState((state) => {
  connectionStatus.textContent = state.charAt(0).toUpperCase() + state.slice(1);
  connectionStatus.className = `connection-status ${state}`;

  // Enable/disable input based on connection
  const canSend = state === "open" && currentUser.userId;
  messageInput.disabled = !canSend;
  sendButton.disabled = !canSend;
});

// Handle room list
client.on(RoomList, (msg) => {
  rooms = msg.payload.rooms;
  renderRoomList();
});

// Handle authentication success
client.on(AuthSuccess, (msg) => {
  const { userId, username } = msg.payload;
  currentUser.userId = userId;
  currentUser.username = username;

  // Store token for next session
  localStorage.setItem("chatToken", Math.random().toString(36).substring(7));

  usernameElement.textContent = username;
  loginButton.textContent = "Logout";

  // Enable message input
  messageInput.disabled = false;
  sendButton.disabled = false;
});

// Handle user joined
client.on(UserJoined, (msg) => {
  if (msg.payload.roomId === currentRoomId) {
    const isCurrentUser = msg.payload.userId === currentUser.userId;
    const text = isCurrentUser
      ? "You joined the room"
      : `${msg.payload.username} joined the room`;
    addSystemMessage(text);
  }
});

// Handle user left
client.on(UserLeft, (msg) => {
  if (msg.payload.roomId === currentRoomId) {
    const isCurrentUser = msg.payload.userId === currentUser.userId;
    const text = isCurrentUser
      ? "You left the room"
      : `${msg.payload.username} left the room`;
    addSystemMessage(text);
  }
});

// Handle chat message
client.on(ChatMessage, (msg) => {
  if (msg.payload.roomId === currentRoomId) {
    const { userId, username, text, timestamp } = msg.payload;
    const isOwnMessage = userId === currentUser.userId;

    const messageEl = document.createElement("div");
    messageEl.className = `message ${isOwnMessage ? "own" : ""}`;
    messageEl.innerHTML = `
      <div class="header">
        <span class="username">${isOwnMessage ? "You" : username}</span>
        <span class="time">${new Date(timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="text">${escapeHtml(text)}</div>
    `;

    messagesContainer.appendChild(messageEl);
    scrollToBottom();
  }
});

// Handle typing indicator
client.on(UserTyping, (msg) => {
  if (
    msg.payload.roomId === currentRoomId &&
    msg.payload.userId !== currentUser.userId
  ) {
    typingIndicator.textContent = `${msg.payload.username} is typing...`;

    setTimeout(() => {
      typingIndicator.textContent = "";
    }, 3000);
  }
});

// Error handling
client.onError((error, context) => {
  console.error("WebSocket error:", error.message, context);

  if (context.type === "validation") {
    addSystemMessage("Received invalid message from server", true);
  } else if (context.type === "parse") {
    addSystemMessage("Failed to parse message", true);
  }
});

// Render room list
function renderRoomList() {
  roomList.innerHTML = "";
  rooms.forEach((room) => {
    const li = document.createElement("li");
    li.className = `room-item ${room.id === currentRoomId ? "active" : ""}`;
    li.textContent = `${room.name} (${room.userCount})`;
    li.addEventListener("click", () => joinRoom(room.id));
    roomList.appendChild(li);
  });
}

// Join a room
function joinRoom(roomId) {
  if (currentRoomId === roomId) return;

  messagesContainer.innerHTML = "";
  typingIndicator.textContent = "";
  currentRoomId = roomId;

  const room = rooms.find((r) => r.id === roomId);
  if (room) {
    roomHeader.textContent = room.name;
  }

  client.send(JoinRoom, { roomId });
  renderRoomList();
}

// Send a chat message
function sendChatMessage(text) {
  if (!text.trim() || !currentRoomId) return;

  const sent = client.send(SendMessage, {
    roomId: currentRoomId,
    text: text.trim(),
  });

  if (sent) {
    messageInput.value = "";
  } else {
    addSystemMessage("Failed to send message", true);
  }
}

// Add system message
function addSystemMessage(text, isError = false) {
  const messageEl = document.createElement("div");
  messageEl.className = `message system ${isError ? "error" : ""}`;
  messageEl.textContent = text;
  messagesContainer.appendChild(messageEl);
  scrollToBottom();
}

// Utilities
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Event listeners
loginButton.addEventListener("click", () => {
  if (currentUser.userId) {
    // Logout
    localStorage.removeItem("chatToken");
    currentUser = { userId: null, username: null };
    usernameElement.textContent = "Not logged in";
    loginButton.textContent = "Login";
    client.close();
  } else {
    // Login
    client.send(Authenticate, { token: "demo-token" });
  }
});

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendChatMessage(messageInput.value);
});

messageInput.addEventListener("input", () => {
  if (currentRoomId && client.isConnected) {
    client.send(TypingStart, { roomId: currentRoomId });
  }
});

// Optional: Log connection state changes
client.onState((state) => {
  console.log("Connection state:", state);
});
```

### Step 6: Running the Application

With everything in place, let’s run our chat application:

```bash
bun run server.ts
```

Now open your browser to `http://localhost:3000`, and you should see the chat interface. You can:

1. Click the login button to get a random username
2. Join one of the two default rooms (General Chat or Random Stuff)
3. Send messages and see them appear in real-time
4. See typing indicators when other users are typing

You can even open multiple browser tabs to simulate different users!

### Extending the Application

This chat application is just a starting point. With the robust foundation provided by **WS-Kit**, you can easily extend it with additional features:

1. **Direct messaging**: Add a new message schema for private messaging between users
2. **User profiles**: Store and display more information about users
3. **Message history**: Add persistence to store chat history
4. **Room creation**: Allow users to create their own chat rooms
5. **Rich media**: Improve the attachment support for images, videos, etc.
6. **Moderation tools**: Add features for admins to moderate chats

### Conclusion

We've built a complete real-time chat application using Bun, WebSockets, and **WS-Kit**. The application features:

- Type-safe messaging with Zod schemas
- Room-based chat with join/leave notifications
- User authentication
- Real-time message delivery
- Typing indicators
- Error handling

Despite the simplicity of our example, it showcases the power of a type-safe approach to WebSocket messaging. By defining our message schemas upfront and using **WS-Kit** to handle validation and routing, we've created a codebase that's easy to understand, extend, and maintain.

No more giant switch statements. No more type coercion surprises. No more undefined property errors. Just clean, type-safe WebSocket messaging that scales with your application’s needs.

So the next time someone asks you to build “just a simple chat app” (which, let’s be honest, is never simple), you’ll have the tools you need to build it properly from the start. Your future self — the one who has to maintain this code six months from now while sipping coffee at 2 AM — will thank you.

## Part 5: Advanced Patterns

### Beyond the Basics: Leveling Up Your WebSocket Game

Now that we've built a functional chat application, let's dive into some advanced patterns that can take your WebSocket applications from "it works" to "wow, that's impressive!" After all, anyone can build a chat app — it's like the "Hello World" of WebSockets — but production-grade applications require more sophisticated techniques.

Think of these patterns as the difference between knowing how to play "Hot Cross Buns" on the recorder and performing a jazz improvisation. Same instrument, vastly different results. Let's jazz things up!

> **Note on Client vs Server Patterns**
>
> The `@ws-kit/client` SDK handles many advanced patterns automatically on the client side. This section covers:
>
> **Client-side (handled by @ws-kit/client SDK)**:
>
> - ✅ Connection pooling and state management (`client.state`)
> - ✅ Automatic reconnection with exponential backoff
> - ✅ Request/response correlation (RPC via `client.request()`)
> - ✅ Heartbeat monitoring
> - ✅ Message queueing while disconnected
> - ✅ Centralized error handling (`client.onError()`)
>
> **Server-side patterns (covered in this section)**:
>
> - Multi-client connection tracking and registration
> - Rate limiting per user or connection
> - Broadcasting to subsets of clients
> - Advanced pub/sub with selective message delivery
> - Protocol negotiation and feature detection
>
> For most applications, the SDK's built-in features are sufficient. The patterns here address production scenarios requiring custom server-side orchestration.

### Connection Pools and Client Tracking

In production applications, you’ll often need to keep track of connected clients beyond what’s directly available in the WebSocket object. This is especially important for features like:

- Displaying online/offline status
- User activity monitoring
- Rate limiting
- Resource cleanup

Here's a robust connection pool implementation using **WS-Kit**:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import type { ServerWebSocket } from "bun";

type ClientInfo = {
  userId: string;
  username: string;
  connectedAt: number;
  lastActivity: number;
  rooms: Set<string>;
};

class ConnectionPool<T> {
  private clients = new Map<string, ServerWebSocket<T & ClientInfo>>();
  private userConnections = new Map<string, Set<string>>();

  /**
   * Register a new connection
   */
  add(
    clientId: string,
    ws: ServerWebSocket<T & ClientInfo>,
    userId?: string,
  ): void {
    // Store connection by client ID
    this.clients.set(clientId, ws as ServerWebSocket<T & ClientInfo>);

    // Track by user ID if available
    if (userId) {
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(clientId);
    }
  }

  /**
   * Update user ID for an existing connection
   */
  associateWithUser(clientId: string, userId: string): void {
    const ws = this.clients.get(clientId);
    if (!ws) return;

    ws.data.userId = userId;

    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(clientId);
  }

  /**
   * Remove a connection
   */
  remove(clientId: string): void {
    const ws = this.clients.get(clientId);
    if (!ws) return;

    const userId = ws.data.userId;

    // Remove from clients map
    this.clients.delete(clientId);

    // Clean up user association
    if (userId && this.userConnections.has(userId)) {
      const connections = this.userConnections.get(userId)!;
      connections.delete(clientId);

      if (connections.size === 0) {
        this.userConnections.delete(userId);
      }
    }
  }

  /**
   * Update activity timestamp
   */
  updateActivity(clientId: string): void {
    const ws = this.clients.get(clientId);
    if (ws) {
      ws.data.lastActivity = Date.now();
    }
  }

  /**
   * Check if user is online (has any active connections)
   */
  isUserOnline(userId: string): boolean {
    return (
      this.userConnections.has(userId) &&
      this.userConnections.get(userId)!.size > 0
    );
  }

  /**
   * Get all connections for a user
   */
  getUserConnections(userId: string): ServerWebSocket<T & ClientInfo>[] {
    if (!this.userConnections.has(userId)) return [];

    return Array.from(this.userConnections.get(userId)!)
      .map((clientId) => this.clients.get(clientId))
      .filter(Boolean) as ServerWebSocket<T & ClientInfo>[];
  }

  /**
   * Get all clients
   */
  getAllClients(): ServerWebSocket<T & ClientInfo>[] {
    return Array.from(this.clients.values());
  }

  /**
   * Send message to all connections of a specific user
   */
  sendToUser<S, P>(userId: string, schema: S, payload: P): void {
    const connections = this.getUserConnections(userId);

    for (const ws of connections) {
      // Using the WebSocketRouter's message format
      ws.send(
        JSON.stringify({
          type: (schema as any).type,
          payload,
        }),
      );
    }
  }
}

export default ConnectionPool;
```

Now let's integrate it with our router:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { randomUUID } from "crypto";
import ConnectionPool from "./connection-pool";
import * as schema from "./schemas";
import chatRouter from "./chat-router";

type AppData = schema.Meta & {
  clientId: string;
  connectedAt: number;
  lastActivity: number;
};

// Create the WebSocket router
const router = createRouter<AppData>();

// Create connection pool
const pool = new ConnectionPool<AppData>();

// Add connection tracking
router.onOpen((ctx) => {
  // Generate a unique ID for this connection
  const clientId = randomUUID();

  // Set initial connection metadata
  ctx.data.clientId = clientId;
  ctx.data.connectedAt = Date.now();
  ctx.data.lastActivity = Date.now();

  // Add to connection pool
  pool.add(clientId, ctx.ws);

  console.log(`Client connected: ${clientId}`);
});

// Add activity tracking middleware
router.use((ctx, next) => {
  // Update last activity timestamp
  ctx.data.lastActivity = Date.now();
  pool.updateActivity(ctx.data.clientId);

  // Continue processing
  return next();
});

// When user authenticates, associate their connection with their user ID
router.on(schema.Authenticate, (ctx) => {
  // Authentication logic...

  // Associate connection with user
  if (ctx.data.userId) {
    pool.associateWithUser(ctx.data.clientId, ctx.data.userId);
  }

  // Continue with normal flow...
});

// Handle disconnection
router.onClose((ctx) => {
  console.log(`Client disconnected: ${ctx.data.clientId}`);
  pool.remove(ctx.data.clientId);
});

// Add our chat routes
router.merge(chatRouter);

// Expose pool to other modules
export { pool };
```

With this connection pool, you can now easily:

- Send messages to all of a user’s devices (multi-device support)
- Check if users are online
- Implement presence detection
- Monitor connection statistics

### Rate Limiting and Throttling

Nothing ruins a WebSocket service faster than a client that sends messages at the speed of light (or a poorly written client that got stuck in a message loop). Let’s implement a rate limiter middleware:

```typescript
import { z, createRouter } from "@ws-kit/zod";

type RateLimitOptions = {
  // Maximum messages per window
  maxMessages: number;

  // Time window in milliseconds
  windowMs: number;

  // Optional exception for specific message types
  excludeTypes?: string[];
};

type RateLimitData = {
  counter: number;
  resetAt: number;
};

// Store rate limit data by client ID
const limiters = new Map<string, RateLimitData>();

// Clean up stale rate limit data every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [clientId, data] of limiters.entries()) {
      if (data.resetAt <= now) {
        limiters.delete(clientId);
      }
    }
  },
  5 * 60 * 1000,
);

// Create rate limiter middleware
export function createRateLimiter(options: RateLimitOptions) {
  const { maxMessages, windowMs, excludeTypes = [] } = options;

  return async function rateLimiterMiddleware(ctx, next) {
    // Skip rate limiting for excluded message types
    if (excludeTypes.includes(ctx.type)) {
      await next();
      return;
    }

    const clientId = ctx.data.clientId;

    if (!clientId) {
      // Can't rate limit without client ID
      return next();
    }

    const now = Date.now();
    let limiter = limiters.get(clientId);

    // Initialize or reset if window has passed
    if (!limiter || limiter.resetAt <= now) {
      limiter = {
        counter: 0,
        resetAt: now + windowMs,
      };
      limiters.set(clientId, limiter);
    }

    // Check if rate limit exceeded
    if (limiter.counter >= maxMessages) {
      const secondsRemaining = Math.ceil((limiter.resetAt - now) / 1000);

      // Send error message with proper details
      ctx.error(
        "RESOURCE_EXHAUSTED",
        "Rate limit exceeded",
        { secondsRemaining, maxMessages, windowMs },
        { retryable: true, retryAfterMs: limiter.resetAt - now },
      );

      return; // Stop processing
    }

    // Increment counter and continue
    limiter.counter++;
    await next();
  };
}
```

Now let's apply this middleware to our router:

```typescript
import { z, createRouter } from "@ws-kit/zod";
import { createRateLimiter } from "./rate-limiter";

const router = createRouter<AppData>();

// Apply rate limiting
router.use(
  createRateLimiter({
    maxMessages: 20, // 20 messages
    windowMs: 10_000, // per 10 seconds
    excludeTypes: [
      // Don't rate limit typing indicators
      "TYPING_START",
      "TYPING_STOP",
    ],
  }),
);

// Rest of your server setup...
```

### Custom PubSub with Selective Message Delivery

While **WS-Kit** provides built-in pub/sub through `ctx.publish()` and `ctx.topics.subscribe()`, sometimes you need advanced filtering based on user properties. This section shows a custom implementation for scenarios requiring fine-grained control:

**For most applications, WS-Kit's native pub/sub is sufficient:**

```typescript
// Simple room-based broadcasting with WS-Kit
router.on(schema.ChatMessage, (ctx) => {
  const { roomId, text } = ctx.payload;

  // Publish to all subscribers in room (with validation)
  ctx.publish(roomId, schema.ChatMessage, {
    roomId,
    userId: ctx.data.userId,
    username: ctx.data.username,
    text,
    timestamp: Date.now(),
  });
});

router.on(schema.JoinRoom, async (ctx) => {
  const { roomId } = ctx.payload;
  await ctx.topics.subscribe(roomId); // Join room
});

router.on(schema.LeaveRoom, async (ctx) => {
  const { roomId } = ctx.payload;
  await ctx.topics.unsubscribe(roomId); // Leave room
});
```

> **When to Use EnhancedPubSub:** WS-Kit's native `ctx.publish()` and `ctx.topics.subscribe()` are sufficient for most applications, providing simple topic-based broadcasting with automatic message validation. Consider implementing a custom PubSub extension only when you need role-based filtering, metadata-based message delivery, or complex subscriber filtering logic that goes beyond basic topic subscriptions. For typical chat applications, room management, and notification systems, stick with the native approach shown above.

\*\*For advanced filtering use cases, here's a custom PubSub extension:

```typescript
import { z, createRouter, message } from "@ws-kit/zod";
import type { ServerWebSocket } from "bun";

// Define a topic subscriber with filtering options
type Subscriber<T> = {
  ws: ServerWebSocket<T>;
  filter?: (meta: T) => boolean;
};

class EnhancedPubSub<T> {
  private topics = new Map<string, Set<Subscriber<T>>>();

  /**
   * Subscribe a client to a topic with optional filter
   */
  subscribe(
    ws: ServerWebSocket<T>,
    topic: string,
    filter?: (meta: T) => boolean,
  ): void {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, new Set());
    }

    this.topics.get(topic)!.add({ ws, filter });
  }

  /**
   * Unsubscribe a client from a topic
   */
  unsubscribe(ws: ServerWebSocket<T>, topic: string): void {
    if (!this.topics.has(topic)) return;

    const subscribers = this.topics.get(topic)!;
    const toRemove = Array.from(subscribers).filter((sub) => sub.ws === ws);

    for (const sub of toRemove) {
      subscribers.delete(sub);
    }

    if (subscribers.size === 0) {
      this.topics.delete(topic);
    }
  }

  /**
   * Unsubscribe a client from all topics
   */
  unsubscribeAll(ws: ServerWebSocket<T>): void {
    for (const [topic, subscribers] of this.topics.entries()) {
      this.unsubscribe(ws, topic);
    }
  }

  /**
   * Publish a message to all subscribers of a topic
   */
  publish<S, P>(
    sourceSender: ServerWebSocket<T> | null,
    topic: string,
    schema: S,
    payload: P,
    skipSender: boolean = true,
  ): number {
    if (!this.topics.has(topic)) return 0;

    const subscribers = this.topics.get(topic)!;
    let sentCount = 0;

    const message = JSON.stringify({
      type: (schema as any).type,
      payload,
    });

    for (const { ws, filter } of subscribers) {
      // Skip sender if requested
      if (skipSender && ws === sourceSender) continue;

      // Apply filter if one exists
      if (filter && !filter(ws.data)) continue;

      // Send the message
      ws.send(message);
      sentCount++;
    }

    return sentCount;
  }

  /**
   * Get count of subscribers for a topic
   */
  subscriberCount(topic: string): number {
    return this.topics.has(topic) ? this.topics.get(topic)!.size : 0;
  }

  /**
   * Get all topics a client is subscribed to
   */
  getSubscribedTopics(ws: ServerWebSocket<T>): string[] {
    const result: string[] = [];

    for (const [topic, subscribers] of this.topics.entries()) {
      if (Array.from(subscribers).some((sub) => sub.ws === ws)) {
        result.push(topic);
      }
    }

    return result;
  }
}

export default EnhancedPubSub;
```

Now we can use this advanced PubSub system to implement features like:

```typescript
import EnhancedPubSub from "./enhanced-pubsub";
import { z, createRouter } from "@ws-kit/zod";
import * as schema from "./schemas";

type AppData = schema.Meta;

const router = createRouter<AppData>();
const pubsub = new EnhancedPubSub<AppData>();

// Handle room joining with role-based filters
router.on(schema.JoinRoom, (ctx) => {
  const { roomId } = ctx.payload;
  const userId = ctx.data.userId;
  const username = ctx.data.username;
  const userRole = ctx.data.userRole || "user";

  // Subscribe with filter - only receive messages for your role level and below
  pubsub.subscribe(ctx.ws, roomId, (clientData) => {
    const messageMinRole = clientData.messageMinRole || "user";

    if (messageMinRole === "admin" && userRole !== "admin") {
      return false; // Filter out admin-only messages
    }
    if (
      messageMinRole === "moderator" &&
      userRole !== "admin" &&
      userRole !== "moderator"
    ) {
      return false; // Filter out moderator-only messages
    }

    return true;
  });

  // Let others know user joined
  pubsub.publish(ctx.ws, roomId, schema.UserJoined, {
    roomId,
    userId,
    username,
  });

  console.log(`User ${username} (${userId}) joined room: ${roomId}`);
});

// Send message only to admins and moderators
router.on(schema.ModAction, (ctx) => {
  const { roomId, action } = ctx.payload;

  // Only allow moderators and admins to send mod actions
  const userRole = ctx.data.userRole;
  if (userRole !== "moderator" && userRole !== "admin") {
    ctx.error(
      "PERMISSION_DENIED",
      "You don't have permission to perform moderator actions",
    );
    return;
  }

  // Set minimum role to receive this message
  ctx.data.messageMinRole = "moderator";

  // Publish to room (only mods/admins will receive it due to filter)
  pubsub.publish(ctx.ws, roomId, schema.ModAction, {
    roomId,
    userId: ctx.data.userId,
    username: ctx.data.username,
    action,
  });

  // Reset the message minimum role
  ctx.data.messageMinRole = "user";
});

// Clean up subscriptions when user leaves
router.onClose((ctx) => {
  pubsub.unsubscribeAll(ctx.ws);
});

export default router;
```

### Request/Response Pattern (RPC)

Real-time applications often need reliable request/response patterns for operations like fetching data, updating settings, or triggering actions. **WS-Kit** provides built-in RPC support with automatic correlation IDs, timeouts, and type safety.

#### Server-Side RPC Handler

Define request and response schemas, then handle with `router.rpc()`:

```typescript
import { z, message, createRouter } from "@ws-kit/zod";

// Define request and response schemas
const FetchProfile = message("FETCH_PROFILE", { userId: z.string() });
const ProfileResponse = message("PROFILE_RESPONSE", {
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

const router = createRouter<AppData>();

// Handle RPC request
router.rpc(FetchProfile, async (ctx) => {
  const { userId } = ctx.payload;

  try {
    // Fetch user profile from database
    const profile = await fetchUserProfileFromDb(userId);

    if (!profile) {
      // Send error response
      ctx.error("NOT_FOUND", `User ${userId} not found`);
      return;
    }

    // Send typed response (automatically correlates with request)
    ctx.reply(ProfileResponse, profile);
  } catch (error) {
    ctx.error("INTERNAL", "Failed to fetch profile");
  }
});
```

**Key RPC features**:

- ✅ Automatic correlation ID generation
- ✅ Built-in timeout handling
- ✅ Full type safety on both request and response
- ✅ Structured error responses with gRPC-standard error codes

> **Error Codes:** WS-Kit uses gRPC-standard error codes for consistency across your application. Common codes include: `NOT_FOUND` (resource doesn't exist), `PERMISSION_DENIED` (insufficient permissions), `INVALID_ARGUMENT` (malformed request), `INTERNAL` (server error), `RESOURCE_EXHAUSTED` (rate limit exceeded), `UNAUTHENTICATED` (missing or invalid credentials), and `UNAVAILABLE` (service temporarily down). Use these standard codes in `ctx.error()` for predictable client-side error handling.

#### Client-Side RPC Call

On the client, `client.request()` handles correlation automatically:

```javascript
// Client code using @ws-kit/client/zod
import {
  wsClient,
  TimeoutError,
  ServerError,
  ConnectionClosedError,
} from "@ws-kit/client/zod";
import { FetchProfile, ProfileResponse } from "./shared/schemas.js";

const client = wsClient({ url: "ws://localhost:3000/ws" });

async function getUserProfile(userId) {
  try {
    // Send request and wait for typed response
    const response = await client.request(
      FetchProfile,
      { userId },
      ProfileResponse,
      { timeoutMs: 5000 }, // 5 second timeout
    );

    console.log("Profile:", response.payload);
    // response.payload is fully typed: { id: string, name: string, email: string }

    return response.payload;
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error(`Request timed out after ${error.timeoutMs}ms`);
    } else if (error instanceof ServerError) {
      console.error(`Server error: ${error.code}`, error.context);
    } else if (error instanceof ConnectionClosedError) {
      console.error("Connection closed before reply");
    }
    throw error;
  }
}

// Usage
const profile = await getUserProfile("user-123");
```

**Client request features**:

- ✅ Automatic `correlationId` generation (UUIDv4)
- ✅ Configurable timeout (default: 30 seconds)
- ✅ AbortSignal support for cancellation
- ✅ Typed responses with validation
- ✅ Automatic reconnection with queued requests

#### Cancellation with AbortSignal

The client SDK supports standard `AbortSignal` for cancelling in-flight RPC requests. This is useful when users navigate away from a page, close a modal, or when you want to implement request debouncing. Cancelled requests are cleaned up immediately without waiting for timeouts.

```javascript
const controller = new AbortController();

const promise = client.request(
  FetchProfile,
  { userId: "user-123" },
  ProfileResponse,
  { signal: controller.signal },
);

// Cancel the request
setTimeout(() => controller.abort(), 2000);

try {
  const response = await promise;
} catch (error) {
  if (error instanceof StateError && error.message.includes("aborted")) {
    console.log("Request was cancelled by user");
  }
}
```

The `@ws-kit/client` SDK automatically handles correlation, timeouts, and retries, so you don't need to implement custom request tracking. Just use `client.request()` as shown above.

### Connection Health Monitoring with Heartbeats

WebSocket connections can silently die or become "zombies" where the TCP connection is technically open but no longer passing messages. **WS-Kit** provides built-in heartbeat support through router configuration:

> **Note:** WS-Kit's heartbeat system operates on two layers: (1) the framework's automatic WebSocket ping/pong frames for detecting broken connections, and (2) optional application-level custom heartbeat messages for measuring client latency and application responsiveness. The example below demonstrates both layers working together.

```typescript
import { z, createRouter, message } from "@ws-kit/zod";
import { serve } from "@ws-kit/bun";
import type { Meta } from "./schemas";

// Define custom heartbeat messages for application-level monitoring
export const HeartbeatPing = message("HEARTBEAT_PING", {
  timestamp: z.number(),
});

export const HeartbeatPong = message("HEARTBEAT_PONG", {
  timestamp: z.number(),
  latency: z.number().optional(),
});

// Setup router with built-in heartbeat
const router = createRouter<Meta>({
  heartbeat: {
    intervalMs: 30_000, // Send heartbeat every 30 seconds
    timeoutMs: 5_000, // Expect response within 5 seconds
    onStaleConnection: (clientId, ws) => {
      console.log(`Stale connection detected: ${clientId}`);
      // Connection is automatically closed by framework
      // Use this callback for cleanup if needed
    },
  },
});

// Optional: handle custom heartbeat messages for latency measurement
router.on(HeartbeatPing, (ctx) => {
  const { timestamp } = ctx.payload;
  const latency = Date.now() - timestamp;

  ctx.send(HeartbeatPong, {
    timestamp,
    latency,
  });
});

// Setup server with heartbeat enabled
serve(router, {
  port: 3000,
});
```

The `@ws-kit/client` SDK handles heartbeat monitoring automatically when configured:

```javascript
import { wsClient } from "@ws-kit/client/zod";

const client = wsClient({
  url: "ws://localhost:3000/ws",
  heartbeat: {
    // Optional: SDK can detect stale connections
    // Heartbeat is handled transparently via WebSocket ping/pong
  },
});

// Monitor connection health via state changes
client.onState((state) => {
  if (state === "closed") {
    console.warn("Connection closed, client will auto-reconnect");
  } else if (state === "open") {
    console.log("Connection healthy and open");
  }
});

// Optional: Measure latency with custom heartbeat messages
const HeartbeatPing = message("HEARTBEAT_PING", { timestamp: z.number() });
const HeartbeatPong = message("HEARTBEAT_PONG", { timestamp: z.number() });

client.on(HeartbeatPong, (msg) => {
  const latency = Date.now() - msg.payload.timestamp;
  console.log(`Latency: ${latency}ms`);
});

// Measure latency periodically
setInterval(() => {
  if (client.isConnected) {
    client.send(HeartbeatPing, { timestamp: Date.now() });
  }
}, 30_000);
```

**Key advantages of WS-Kit's built-in heartbeat:**

- Automatic detection of stale connections
- No manual connection tracking needed
- Configurable intervals and timeouts
- Framework handles connection cleanup
- Can be disabled by omitting heartbeat config

### Connection Upgrades and Protocol Negotiation

In sophisticated applications, you might need to negotiate protocol features or upgrade connections to support different functionality:

```typescript
import { z, createRouter, message } from "@ws-kit/zod";
import type { Meta } from "./schemas";

// Define feature flags
export enum Feature {
  COMPRESSION = "compression",
  ENCRYPTION = "encryption",
  BATCHING = "batching",
  BINARY_MESSAGES = "binary_messages",
}

// Negotiation message schemas
export const ClientCapabilities = message("CLIENT_CAPABILITIES", {
  protocolVersion: z.string(),
  features: z.array(z.nativeEnum(Feature)),
  compressionFormats: z.array(z.string()).optional(),
});

export const ServerCapabilities = message("SERVER_CAPABILITIES", {
  protocolVersion: z.string(),
  supportedFeatures: z.array(z.nativeEnum(Feature)),
  enabledFeatures: z.array(z.nativeEnum(Feature)),
  compressionFormat: z.string().optional(),
});

// Setup protocol negotiation
export function setupProtocolNegotiation(router) {
  // Server supported features
  const supportedFeatures = [Feature.COMPRESSION, Feature.BATCHING];

  // Handle client capabilities message
  router.on(ClientCapabilities, (ctx) => {
    const { protocolVersion, features, compressionFormats } = ctx.payload;

    // Check protocol version compatibility
    if (!isCompatibleVersion(protocolVersion)) {
      ctx.error(
        "INVALID_ARGUMENT",
        `Unsupported protocol version: ${protocolVersion}. Server requires 1.x`,
      );

      // Terminate connection - incompatible protocol
      setTimeout(
        () => ctx.ws.close(1002, "Incompatible protocol version"),
        100,
      );
      return;
    }

    // Determine which features to enable
    const enabledFeatures = supportedFeatures.filter((feature) =>
      features.includes(feature),
    );

    // Store enabled features in connection metadata
    ctx.data.enabledFeatures = enabledFeatures;

    // Determine compression format if requested
    let compressionFormat: string | undefined;

    if (
      enabledFeatures.includes(Feature.COMPRESSION) &&
      compressionFormats &&
      compressionFormats.length > 0
    ) {
      // Choose first supported compression format
      if (compressionFormats.includes("gzip")) {
        compressionFormat = "gzip";
      } else if (compressionFormats.includes("deflate")) {
        compressionFormat = "deflate";
      }

      ctx.data.compressionFormat = compressionFormat;
    }

    // Send server capabilities
    ctx.send(ServerCapabilities, {
      protocolVersion: "1.0",
      supportedFeatures,
      enabledFeatures,
      compressionFormat,
    });

    console.log(
      `Negotiated protocol with ${ctx.data.clientId}: ${enabledFeatures.join(", ")}`,
    );
  });
}

// Check if client version is compatible with server
function isCompatibleVersion(clientVersion: string): boolean {
  // Simple version check - in real app you'd use semver
  return clientVersion.startsWith("1.");
}
```

### Conclusion: The Power of Advanced Patterns

By implementing these advanced patterns, you’ve taken your WebSocket application from a simple message-passing system to a robust, production-ready communication platform. We’ve covered:

1. **Connection management** with tracking, pooling, and user association
2. **Rate limiting** to protect against accidental or malicious overload
3. **Enhanced PubSub** with selective message delivery based on user properties
4. **Request/response patterns** for reliable communication with acknowledgments
5. **Connection health monitoring** with heartbeats to detect zombie connections
6. **Protocol negotiation** for feature detection and progressive enhancement

Each of these patterns addresses real-world challenges you'll face when deploying WebSocket applications at scale. The beauty of using **WS-Kit** is that its clean, type-safe foundation makes it easy to layer these advanced patterns on top without creating a tangled mess of code.

Remember, in the world of WebSockets, the difference between a toy project and a production system isn’t just in the basic functionality — it’s in how gracefully your application handles edge cases, failures, and scale. With these patterns in your toolkit, you’re well-equipped to build WebSocket applications that don’t just work in the happy path, but thrive in the chaotic reality of the real world.

And the next time someone casually suggests “Let’s just add real-time messaging to our app, how hard could it be?”, you can smile knowingly — and then build it right the first time.

## Wrapping It Up

We've taken quite a journey together, exploring how to build robust, type-safe WebSocket applications with Bun and **WS-Kit**. From the basics of WebSocket communication to advanced patterns like connection management, authentication, and error handling, we've covered the essentials of crafting real-time applications that are both maintainable and scalable.

### Why WS-Kit Stands Out

**WS-Kit** represents a modern approach to WebSocket development:

- **Platform-agnostic**: Works with Bun, Cloudflare Durable Objects, and custom adapters
- **Validator-agnostic**: Choose between Zod, Valibot, or your own validation library
- **Production-ready**: Built on lessons learned from years of real-time systems experience
- **Actively developed**: Continuously improved based on community feedback

The library is designed to be the foundation for production applications while remaining simple enough for quick prototypes.

## Getting Support

If you encounter any issues, have questions, or want to contribute to the project, check out the WS-Kit repository on GitHub. You can also connect with the community and maintainers on Discord to share your experiences and get help troubleshooting any problems you might face.

### Final Thoughts

Building real-time applications doesn't have to be complex or error-prone. With the right tools and patterns, you can focus on creating amazing user experiences without getting bogged down in the details of WebSocket message routing or type validation.

Whether you're building a simple chat application or a sophisticated collaborative platform, **WS-Kit** provides the foundation you need to create reliable, type-safe real-time experiences with confidence.

Now go forth and build something amazing! And remember, in the fast-moving world of WebSockets, type safety isn't just a luxury — it's your best friend.

Happy coding!
