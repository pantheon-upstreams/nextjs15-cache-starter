# Next.js Custom Cache Handler Starter

A Next.js 15 application with WordPress integration and custom cache handlers supporting both Google Cloud Storage (GCS) and file-based caching. Built to explore and test different caching strategies including ISR, SSR, SSG, and tagged fetch caching with CDN surrogate key integration.

## Getting Started

```bash
npm install
npm run dev        # Development server at http://localhost:3000
npm run build      # Production build
npm run start      # Production server
npm run lint       # ESLint
```

## Pages

| Route | Rendering Strategy | Description |
|---|---|---|
| `/` | Static | Homepage with navigation to all demo pages |
| `/blogs` | ISR (300s) | Blog listing page, revalidates every 5 minutes |
| `/blogs/:slug` | ISR (600s) | Individual blog post pages, revalidates every 10 minutes. Uses `generateStaticParams` for SSG at build time |
| `/about` | SSR (`force-dynamic`) | Server-rendered on every request, displays live server info |
| `/ssg-demo` | SSG (`force-static`) | Fully static page generated at build time, never changes until rebuild |
| `/cache-test` | Client-side | Interactive UI for testing fetch cache strategies and viewing cache stats |

## API Routes

| Endpoint | Method | Description |
|---|---|---|
| `/api/cache-info` | GET | Lists all available cache strategy endpoints |
| `/api/cache-stats` | GET | View cache statistics and entries |
| `/api/cache-stats` | DELETE | Clear all cache entries |
| `/api/revalidate` | POST | Invalidate a cache tag (`{ "tag": "api-posts" }`) |
| `/api/revalidate` | GET | Invalidate via query param (`?tag=api-posts`) |
| `/api/purge` | POST | Purge surrogate keys (secured with `WEBHOOK_SECRET`, see [Purge Endpoint](#purge-endpoint-apipurge)) |
| `/api/nuke-cdn` | POST | Purge CDN cache via outbound proxy |
| `/api/posts/no-cache` | GET | Fetch demo using `cache: 'no-store'` |
| `/api/posts/force-cache` | GET | Fetch demo using `cache: 'force-cache'` |
| `/api/posts/revalidate` | GET | Fetch demo using `next: { revalidate: 60 }` |
| `/api/posts/with-tags` | GET | Fetch demo using tagged cache with 5min TTL |

## Cache Handler

The custom cache handler is configured in `cache-handler.mjs` using `@pantheon-systems/nextjs-cache-handler`. It auto-detects the storage backend:

- **GCS mode**: Activated when `CACHE_BUCKET` env var is set. This is automatically set when deployed on Pantheon
- **File mode**: Used as fallback for local development

Next.js in-memory caching is disabled (`cacheMaxMemorySize: 0`) so all cache operations go through the custom handler.

## Surrogate-Key Headers in next.config.mjs

The `next.config.mjs` file defines custom response headers using Next.js's [`headers` config](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers). Every rule sets a `Surrogate-Key` header, which CDNs like Fastly or Varnish use for targeted cache purging. Instead of purging by URL pattern, you can purge all responses tagged with a specific surrogate key in a single API call.

### How It Works

Next.js `headers` config supports conditional matching with:

- **`source`** — a path pattern (supports `:param` dynamic segments)
- **`has`** — requires a query parameter to be present (with regex capture groups)
- **`missing`** — requires a query parameter to be absent

The captured values from dynamic segments (`:slug`) and regex groups (`(?<version>.*)`) are interpolated into the header value.

### Header Rules

#### 1. Blog post with `version` query param

```
GET /blogs/my-post?version=2
```

**Surrogate-Key:** `blog-my-post-v2`

This matches any blog post URL that includes a `version` query parameter. The `:slug` from the path and the captured `version` value are both interpolated into the key.

```js
{
  source: '/blogs/:slug',
  has: [{ type: 'query', key: 'version', value: '(?<version>.*)' }],
  headers: [{ key: 'Surrogate-Key', value: 'blog-:slug-v:version' }],
}
```

#### 2. Blog post with `categories` query param

```
GET /blogs/my-post?categories=javascript
```

**Surrogate-Key:** `blog-my-post-categogies-javascript`

Matches blog posts filtered by category. Uses the same pattern as version matching but captures the `categories` query param instead.

```js
{
  source: '/blogs/:slug',
  has: [{ type: 'query', key: 'categories', value: '(?<categories>.*)' }],
  headers: [{ key: 'Surrogate-Key', value: 'blog-:slug-categogies-:categories' }],
}
```

#### 3. Blog post without query params

```
GET /blogs/my-post
```

**Surrogate-Key:** `blog-my-post`

Matches blog post URLs that do **not** have `version` or `tag` query parameters. The `missing` condition ensures this rule only applies to "clean" blog URLs.

```js
{
  source: '/blogs/:slug',
  missing: [
    { type: 'query', key: 'version' },
    { type: 'query', key: 'tag' },
  ],
  headers: [{ key: 'Surrogate-Key', value: 'blog-:slug' }],
}
```

#### 4. Blog index with `tag` filter

```
GET /blogs?tag=react
```

**Surrogate-Key:** `blog-index-tag-react`

Matches the blog listing page when filtered by a tag. Purging `blog-index-tag-react` would invalidate only the cached React-tagged listing, not the full blog index.

```js
{
  source: '/blogs',
  has: [{ type: 'query', key: 'tag', value: '(?<tag>.*)' }],
  headers: [{ key: 'Surrogate-Key', value: 'blog-index-tag-:tag' }],
}
```

#### 5. Blog index without query params

```
GET /blogs
```

**Surrogate-Key:** `blog-index`

Matches the plain blog listing page with no filters applied.

```js
{
  source: '/blogs',
  missing: [{ type: 'query', key: 'tag' }],
  headers: [{ key: 'Surrogate-Key', value: 'blog-index' }],
}
```

#### 6. Fallback for all other pages

```
GET /about
GET /ssg-demo
GET /any-other-page
```

**Surrogate-Key:** `unknown`

Catches all remaining routes **except** `/api/*`, `/_next/static/*`, `/_next/image/*`, `/favicon.ico`, and `/blogs/*` (which are handled by the rules above). The negative lookahead regex `((?!api|_next/static|_next/image|favicon.ico|blogs).*)` excludes these paths.

```js
{
  source: '/((?!api|_next/static|_next/image|favicon.ico|blogs).*)',
  headers: [{ key: 'Surrogate-Key', value: 'unknown' }],
}
```

### Summary Table

| Request | Surrogate-Key |
|---|---|
| `GET /blogs/my-post?version=2` | `blog-my-post-v2` |
| `GET /blogs/my-post?categories=javascript` | `blog-my-post-categogies-javascript` |
| `GET /blogs/my-post` | `blog-my-post` |
| `GET /blogs?tag=react` | `blog-index-tag-react` |
| `GET /blogs` | `blog-index` |
| `GET /about` | `unknown` |
| `GET /ssg-demo` | `unknown` |
| `GET /api/cache-stats` | *(no header — excluded)* |
| `GET /_next/static/chunk.js` | *(no header — excluded)* |

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `WORDPRESS_API_URL` | WordPress REST API base URL | `https://developer.wordpress.org/news/wp-json/wp/v2` |
| `WEBHOOK_SECRET` | Shared secret for authenticating `/api/purge` requests | — (required for purge endpoint) |

## Middleware

`middleware.ts` adds debug headers (`x-middleware-executed`, `x-intercepted-path`) to all non-static requests. **Warning:** Middleware is incompatible with `NEXT_PRIVATE_MINIMAL_MODE=1` — it causes empty responses on all intercepted routes.

## Purge Endpoint (`/api/purge`)

The `/api/purge` endpoint accepts one or more surrogate keys and calls `revalidateTag()` for each, triggering Next.js edge cache clearing. It is secured with a shared secret so only trusted sources (e.g., your WordPress site) can trigger purges.

### Authentication

Set the same `WEBHOOK_SECRET` value on both the Next.js site and the WordPress site. Requests must include the secret via one of:

- `Authorization: Bearer <WEBHOOK_SECRET>`
- `x-webhook-secret: <WEBHOOK_SECRET>`

If `WEBHOOK_SECRET` is not configured, all requests are rejected with `401`.

### Request Format

The `surrogateKeys` field accepts a single string or an array:

```bash
# Single key
curl -X POST https://your-nextjs-site.com/api/purge \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-here" \
  -d '{ "surrogateKeys": "blog-my-post" }'

# Multiple keys
curl -X POST https://your-nextjs-site.com/api/purge \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret-here" \
  -d '{ "surrogateKeys": ["blog-my-post", "blog-index", "blog-index-tag-react"] }'
```

### Response

```json
{
  "message": "Purged 3 surrogate key(s)",
  "purged_keys": ["blog-my-post", "blog-index", "blog-index-tag-react"],
  "purged_at": "2026-03-12T10:30:00.000Z"
}
```

## WordPress Integration

Blog content is fetched from a WordPress site via the [WP REST API](https://developer.wordpress.org/rest-api/). By default, it uses the WordPress Developer News site (`developer.wordpress.org/news`) as a working demo source.

### Connecting to Your Own WordPress Site

Set the `WORDPRESS_API_URL` environment variable to point to your WordPress site:

```bash
WORDPRESS_API_URL=https://your-wordpress-site.com/wp-json/wp/v2
```

Any standard WordPress site with the REST API enabled will work — no plugins required. The `_embed` query parameter is used on all fetch calls to inline author and taxonomy data in a single request.

### How It Works

All WordPress data fetching lives in `lib/blogService.ts`. The key functions:

| Function | Purpose |
|---|---|
| `getBlogPosts()` | Fetches up to 10 posts from `/posts?_embed&per_page=10` with 5-minute tagged cache |
| `getBlogPost(slug)` | Fetches a single post by slug from `/posts?slug=...&_embed` with 10-minute tagged cache |
| `transformWordPressPost()` | Maps WordPress response fields to the `BlogPost` interface |
| `stripHtml()` | Strips HTML tags from WordPress rendered fields (`title.rendered`, `excerpt.rendered`) |

### WordPress REST API to BlogPost Field Mapping

The `transformWordPressPost()` function in `lib/blogService.ts` maps WP fields to the app's `BlogPost` type:

```
WP field                                        → BlogPost field
──────────────────────────────────────────────────────────────────
post.id                                         → id
post.author                                     → userId
post.title.rendered                             → title (HTML stripped)
post.content.rendered                           → body (raw HTML, rendered via dangerouslySetInnerHTML)
post.slug                                       → slug (WordPress provides slugs natively)
post.excerpt.rendered                           → excerpt (HTML stripped)
post.date                                       → publishedAt
post._embedded.author[0].name                  → author.name
post._embedded.author[0].url                   → author.website
post._embedded["wp:term"] (categories + tags)  → tags (flattened into a single array of names)
```

### Blog Post Rendering

Blog post content (`body`) is WordPress-rendered HTML. The detail page (`app/blogs/[slug]/page.tsx`) renders it using `dangerouslySetInnerHTML` inside a `prose` container for Tailwind Typography styling:

```tsx
<div
  className="prose prose-zinc dark:prose-invert max-w-none"
  dangerouslySetInnerHTML={{ __html: blog.body }}
/>
```

### On-Demand Cache Purging from WordPress

When content changes in WordPress, you can purge the Next.js edge cache by calling the `/api/purge` endpoint with the relevant surrogate keys:

```
POST https://your-nextjs-site.com/api/purge
Content-Type: application/json
Authorization: Bearer <WEBHOOK_SECRET>

{ "surrogateKeys": ["blog-my-post", "blog-index"] }
```

Set the same `WEBHOOK_SECRET` on both your WordPress site and the Next.js app. This can be triggered from WordPress using:
- A `save_post` / `publish_post` action hook in your theme or a custom plugin
- A webhook plugin like "WP Webhooks"

For example, when a post with slug `my-post` is updated, WordPress could purge `blog-my-post` (the detail page) and `blog-index` (the listing page) in a single request.
