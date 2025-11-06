// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { defineRoutes } from "vitepress";
import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const postsDir = path.resolve(__dirname, "../../posts");

// VitePress dynamic route definition. See: https://vitepress.dev/guide/routing#dynamic-routes
export default defineRoutes({
  watch: ["../../posts/*.md"],

  async paths() {
    if (!fs.existsSync(postsDir)) {
      return [];
    }

    const files = fs
      .readdirSync(postsDir)
      .filter((f) => f.endsWith(".md") && f !== "index.md");

    return files.map((file) => {
      const filePath = path.join(postsDir, file);
      const rawContent = fs.readFileSync(filePath, "utf-8");
      const { content } = matter(rawContent);

      // Extract slug from filename (YYYY-MM-DD_slug.md -> slug)
      const slug = file.substring(11).replace(/\.md$/, "");

      return {
        params: { slug },
        content: content,
      };
    });
  },

  // Inject post frontmatter (including canonical URL) at the route-module level.
  // This runs after the global transformPageData hook and can override values.
  async transformPageData(pageData) {
    const slug = pageData.params?.slug;
    if (!slug) {
      return; // Not a blog post
    }

    try {
      const files = fs
        .readdirSync(postsDir)
        .filter((f) => f.endsWith(".md") && f !== "index.md");

      // Find the post file matching this slug (YYYY-MM-DD_slug.md format)
      for (const file of files) {
        const fileSlug = file.substring(11).replace(/\.md$/, "");
        if (fileSlug === slug) {
          const filePath = path.join(postsDir, file);
          const rawContent = fs.readFileSync(filePath, "utf-8");
          const { data: frontmatter } = matter(rawContent);

          // Merge post frontmatter so VitePress renders head[] tags
          return {
            frontmatter: { ...pageData.frontmatter, ...frontmatter },
          };
        }
      }
    } catch (error) {
      // Silent fail if posts can't be read
    }
  },
});
