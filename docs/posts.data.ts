// SPDX-FileCopyrightText: 2025-present Kriasoft
// SPDX-License-Identifier: MIT

import { createContentLoader, defineLoader } from "vitepress";

export interface Author {
  name: string;
  username: string;
}

export interface Post {
  title: string;
  url: string;
  summary: string;
  date: string;
  author?: Author;
}

declare const data: Post[];
export { data };

export default defineLoader({
  // Watch the actual source directory (/posts/)
  // The plugin copies these to /docs/posts/ before VitePress scans
  watch: ["../posts/*.md"],
  async load(files: string[]): Promise<Post[]> {
    const posts = await createContentLoader("../posts/*.md", {
      excerpt: true,
    }).load();

    return posts
      .map((post) => {
        const frontmatter = post.frontmatter as Record<string, any>;
        const filename = post.url.match(/([^/]+)$/)?.[1] || "";

        // Extract date (first 10 chars: YYYY-MM-DD) and slug from filename
        // e.g., "2025-11-02_token-bucket-policies.md"
        const dateFromFilename = filename.substring(0, 10);
        const slugFromFilename = filename
          .substring(11) // Skip "YYYY-MM-DD_"
          .replace(/\.md$/, "");

        return {
          title: frontmatter?.title || "Untitled",
          url: `/ws-kit/posts/${slugFromFilename}`,
          summary: frontmatter?.summary || "",
          date:
            dateFromFilename ||
            frontmatter?.date ||
            new Date().toISOString().split("T")[0],
          author: frontmatter?.author,
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },
});
