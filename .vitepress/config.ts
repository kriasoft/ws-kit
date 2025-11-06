// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: "/ws-kit/",
  title: "⚡ WS-Kit",
  description:
    "Schema-first WebSocket message router for Bun with TypeScript validation",
  lang: "en-US",
  lastUpdated: true,
  cleanUrls: true,
  srcDir: "docs",

  sitemap: {
    hostname: "https://kriasoft.com/ws-kit/",
    lastmodDateOnly: false,
  },

  head: [
    ["link", { rel: "icon", href: "/ws-kit/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#3c8772" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:locale", content: "en" }],
    [
      "meta",
      {
        property: "og:title",
        content: "Bun WebSocket Router | Schema-First WebSocket Routing",
      },
    ],
    ["meta", { property: "og:site_name", content: "Bun WebSocket Router" }],
    ["meta", { property: "og:url", content: "https://kriasoft.com/ws-kit/" }],
    [
      "meta",
      {
        property: "og:image",
        content: "https://kriasoft.com/ws-kit/og-image.webp",
      },
    ],
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "Docs", link: "/getting-started" },
      { text: "Blog", link: "/posts/" },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/kriasoft/ws-kit/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    sidebar: [
      {
        text: "Manual",
        items: [
          { text: "Getting Started", link: "/getting-started" },
          { text: "Core Concepts", link: "/core-concepts" },
          { text: "Message Schemas", link: "/message-schemas" },
          { text: "API Reference", link: "/api-reference" },
          { text: "Examples", link: "/examples" },
          { text: "Advanced Usage", link: "/advanced-usage" },
          { text: "Deployment", link: "/deployment" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Rate Limiting", link: "/guides/rate-limiting" },
          { text: "On vs RPC", link: "/guides/on-vs-rpc" },
          { text: "RPC Troubleshooting", link: "/guides/rpc-troubleshooting" },
          {
            text: "Advanced Multi-Runtime",
            link: "/guides/advanced-multi-runtime",
          },
        ],
      },
      {
        text: "Client",
        items: [
          { text: "Setup", link: "/client-setup" },
          { text: "API Reference", link: "/client-api" },
          { text: "Authentication", link: "/client-auth" },
          { text: "Error Handling", link: "/client-errors" },
          { text: "Advanced", link: "/client-advanced" },
        ],
      },
      {
        text: "For Developers",
        items: [
          {
            text: "Specifications",
            link: "https://github.com/kriasoft/ws-kit/tree/main/docs/specs",
          },
          {
            text: "Architecture Decisions",
            link: "https://github.com/kriasoft/ws-kit/blob/main/docs/adr",
          },
          {
            text: "Contributing",
            link: "https://github.com/kriasoft/ws-kit/blob/main/.github/CONTRIBUTING.md",
          },
          {
            text: "Security Policy",
            link: "https://github.com/kriasoft/ws-kit/blob/main/.github/SECURITY.md",
          },
          {
            text: "Sponsor",
            link: "https://github.com/sponsors/koistya",
          },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/kriasoft/ws-kit" },
      { icon: "discord", link: "https://discord.gg/aW29wXyb7w" },
      { icon: "x", link: "https://x.com/kriasoft" },
      { icon: "bluesky", link: "https://bsky.app/profile/kriasoft.com" },
    ],

    footer: {
      message:
        'Released under the <a href="https://github.com/kriasoft/ws-kit/blob/main/LICENSE">MIT License</a>.',
      copyright:
        'Copyright © 2025-present <a href="https://kriasoft.com" target="_self">Kriasoft</a> · Created by <a href="https://github.com/koistya">Konstantin Tarkus</a>',
    },
  },

  markdown: {
    config: (md) => {
      const originalNormalizeLink = md.normalizeLink;
      const gitHubBase = "https://github.com/kriasoft/ws-kit/blob/main";

      md.normalizeLink = (url: string) => {
        // Transform relative example links to GitHub URLs
        if (url.startsWith("../../examples/")) {
          return url.replace(
            /^\.\.\/\.\.\/examples\//,
            `${gitHubBase.replace("/blob/", "/tree/")}/examples/`,
          );
        }
        // Transform CLAUDE.md link to GitHub URL
        if (url.includes("../../CLAUDE")) {
          return `${gitHubBase}/CLAUDE.md`;
        }
        // Fall back to original for all other links
        return originalNormalizeLink(url);
      };
    },
  },

  vite: {
    publicDir: "../.vitepress/public",
  },
});
