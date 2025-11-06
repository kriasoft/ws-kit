<script setup lang="ts">
import { useData } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { computed } from "vue";

const { page } = useData();

const frontmatter = computed(
  () => page.value.frontmatter as Record<string, any>,
);
const title = computed(() => frontmatter.value?.title);
const dateString = computed(() => frontmatter.value?.date);

// Parse date from YYYY-MM-DD format (handles string, number, and Date objects)
const postDate = computed(() => {
  const ds = dateString.value;
  if (!ds) return null;

  // If it's already a Date object, validate and return it
  if (ds instanceof Date) {
    return isNaN(ds.getTime()) ? null : ds;
  }

  let dateStr = String(ds); // Convert to string if it's a number

  // Handle YYYY-MM-DD format (with dashes)
  if (dateStr.includes("-")) {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed in JS
    return isNaN(date.getTime()) ? null : date;
  }

  // Handle YYYYMMDD format (8 digits, from YAML number parsing)
  if (/^\d{8}$/.test(dateStr)) {
    const year = Number(dateStr.substring(0, 4));
    const month = Number(dateStr.substring(4, 6));
    const day = Number(dateStr.substring(6, 8));
    const date = new Date(year, month - 1, day); // month is 0-indexed in JS
    return isNaN(date.getTime()) ? null : date;
  }

  // Fallback for other formats
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
});

const author = computed(
  () => frontmatter.value?.author as Record<string, any> | undefined,
);
</script>

<template>
  <DefaultTheme.Layout>
    <template #doc-before>
      <h1>{{ title }}</h1>
      <time
        v-if="postDate"
        :datetime="postDate.toISOString()"
        class="post-date"
      >
        {{
          postDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        }}
      </time>
    </template>
    <template #doc-after>
      <div v-if="author" class="post-author">
        <div class="author-info">
          <div class="published-by">
            Published by
            <a
              :href="`https://github.com/${author.username}`"
              target="_blank"
              rel="noopener noreferrer"
              class="author-name"
            >
              {{ author.name }}
            </a>
          </div>
          <time
            v-if="postDate"
            :datetime="postDate.toISOString()"
            class="author-date"
          >
            {{
              postDate.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            }}
          </time>
        </div>
        <img
          v-if="author.picture"
          :src="author.picture"
          :alt="author.name"
          class="author-picture"
        />
      </div>
    </template>
  </DefaultTheme.Layout>
</template>

<style scoped>
h1 {
  margin: 0 0 1rem 0;
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.2;
  color: var(--vp-c-text-1);
}

.post-date {
  display: block;
  color: var(--vp-c-text-2);
  font-size: 1.125rem;
  font-style: italic;
  margin-bottom: 1rem;
}

.post-author {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid var(--vp-c-divider);
}

.author-info {
  flex: 1;
}

.published-by {
  color: var(--vp-c-text-2);
  font-size: 0.95rem;
}

.author-name {
  color: var(--vp-c-text-1);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
}

.author-name:hover {
  color: var(--vp-c-brand);
}

.author-date {
  display: block;
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
}

.author-picture {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 0.25rem;
}

/* Style first blockquote as a subheader */
:deep(blockquote:first-of-type) {
  border-left: none;
  font-weight: 500;
  padding-left: 0;
}

:deep(blockquote:first-of-type) > p {
  font-size: 1.275rem;
  font-style: italic;
}

/* Hide prev/next navigation for blog posts */
:deep(.prev-next) {
  display: none;
}
</style>
