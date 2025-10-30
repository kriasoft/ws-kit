---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "WS-Kit"
  text: "Type-Safe WebSocket router for Bun and Cloudflare"
  tagline: Type-safe message routing with pluggable validators and platform adapters
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/kriasoft/ws-kit

features:
  - icon: 🛡️
    title: Type-Safe Routing
    details: Define message schemas with Zod or Valibot and get full TypeScript type inference from schema to handler without type assertions
  - icon: 🔄
    title: Request-Response Pattern
    details: Built-in RPC with auto-correlation, timeouts, and streaming progress updates using rpc() helper and ctx.reply()
  - icon: 📡
    title: Broadcasting & PubSub
    details: Type-safe publish/subscribe with topic-based routing. Use ctx.publish() in handlers or router.publish() for system events
  - icon: 🔌
    title: Middleware Support
    details: Global and per-route middleware with async/await support for authentication, rate limiting, and authorization
  - icon: ⚡
    title: Multi-Platform
    details: Works with Bun's high-performance WebSocket server and Cloudflare Durable Objects with platform-specific optimizations
  - icon: 🔧
    title: Structured Error Handling
    details: 13 gRPC-aligned error codes with WsKitError class following WHATWG Error standard. Automatic error responses, cause chaining, and JSON serialization for observability tools
---
