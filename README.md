# Next.js Custom Cache Handler Starter

A Next.js 15 application demonstrating custom cache handlers with support for both Google Cloud Storage (GCS) and file-based caching. Built to explore and test different caching strategies including ISR, SSR, SSG, and tagged fetch caching with CDN surrogate key integration.

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

## Middleware

`middleware.ts` adds debug headers (`x-middleware-executed`, `x-intercepted-path`) to all non-static requests. **Warning:** Middleware is incompatible with `NEXT_PRIVATE_MINIMAL_MODE=1` — it causes empty responses on all intercepted routes.
