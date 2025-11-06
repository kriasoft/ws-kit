---
sidebar: false
---

<script setup>
import { data as posts } from '../posts.data'
</script>

<div class="posts">
  <article v-for="post in posts" :key="post.url" class="post">
    <time :datetime="post.date" class="date">
      {{ new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }}
    </time>
    <h2>
      <a :href="post.url">{{ post.title }}</a>
    </h2>
    <p class="excerpt">{{ post.summary }}</p>
    <a :href="post.url" class="read-more">Read more →</a>
  </article>
</div>

<style scoped>
.posts {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.post {
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 2rem;
}

.post:last-child {
  border-bottom: none;
}

.post h2 {
  margin: 0 0 0.5rem 0;
  font-size: 1.5rem;
}

.post h2 a {
  color: inherit;
  text-decoration: none;
}

.post h2 a:hover {
  color: var(--vp-c-brand);
}

.date {
  display: block;
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
  margin-bottom: 0.75rem;
}

.excerpt {
  color: var(--vp-c-text-1);
  margin: 0.75rem 0;
  line-height: 1.6;
}

.read-more {
  display: inline-block;
  color: var(--vp-c-brand);
  text-decoration: none;
  font-weight: 500;
  margin-top: 0.5rem;
}

.read-more:hover {
  color: var(--vp-c-brand-dark);
  text-decoration: underline;
}
</style>
