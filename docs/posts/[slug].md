---
layout: doc
sidebar: false
---

<script setup lang="ts">
import { computed, onBeforeMount, ref } from 'vue'
import { data as posts } from '../posts.data'

// Extract slug from current location (client-side only)
const slug = ref('')

onBeforeMount(() => {
  // Get slug from current URL path: /posts/token-bucket-policies -> token-bucket-policies
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  slug.value = path.split('/').pop() || ''
})

// Create a lookup map from posts array for O(1) access
const postsMetadata = computed(() => {
  const map: Record<string, any> = {}
  posts.forEach((p) => {
    // Extract slug from URL: /ws-kit/posts/slug -> slug
    const urlParts = p.url.split('/')
    const postSlug = urlParts[urlParts.length - 1]
    map[postSlug] = p
  })
  return map
})

const post = computed(() => postsMetadata.value[slug.value] || {})
const date = computed(() => post.value.date ? new Date(post.value.date) : null)
</script>

<header v-if="post.title || date" class="post-header">
  <time v-if="date" :datetime="date.toISOString()" class="post-date">
    {{ date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }} by <a :href="`https://github.com/${post.author}`">@{{ post.author }}</a>
  </time>
</header>

<!-- @content -->

<style scoped>
.post-header {
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--vp-c-divider);
}

.post-header h1 {
  margin: 0 0 0.5rem 0;
}

.post-date {
  display: block;
  color: var(--vp-c-text-2);
  font-size: 1rem;
  font-style: italic;
}
</style>
