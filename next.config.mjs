import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // logging: {
  //   fetches: {
  //     fullUrl: true,
  //     hmrRefreshes: true,
  //   },
  // },
  cacheHandler: path.resolve(__dirname, './cache-handler.mjs'),
  cacheMaxMemorySize: 0, // disable default in-memory caching
  headers: async () => {
    return [
      {
        // Match blog posts with version query param
        source: '/blogs/:slug',
        has: [
          {
            type: 'query',
            key: 'version',
            value: '(?<version>.*)',
          },
        ],
        headers: [
          {
            key: 'Surrogate-Key',
            value: 'blog-:slug-v:version',
          },
        ],
      },
      {
        // Match blog posts with tag query param
        source: '/blogs/:slug',
        has: [
          {
            type: 'query',
            key: 'categories',
            value: '(?<categories>.*)',
          },
        ],
        headers: [
          {
            key: 'Surrogate-Key',
            value: 'blog-:slug-categogies-:categories',
          },
        ],
      },
      {
        // Match blog posts with dynamic slug (no query params)
        source: '/blogs/:slug',
        missing: [
          { type: 'query', key: 'version' },
          { type: 'query', key: 'tag' },
        ],
        headers: [
          {
            key: 'Surrogate-Key',
            value: 'blog-:slug',
          },
        ],
      },
      {
        // Match blog index with tag filter
        source: '/blogs',
        has: [
          {
            type: 'query',
            key: 'tag',
            value: '(?<tag>.*)',
          },
        ],
        headers: [
          {
            key: 'Surrogate-Key',
            value: 'blog-index-tag-:tag',
          },
        ],
      },
      {
        // Match blog index (no query params)
        source: '/blogs',
        missing: [
          { type: 'query', key: 'tag' },
        ],
        headers: [
          {
            key: 'Surrogate-Key',
            value: 'blog-index',
          },
        ],
      },
      {
        // Fallback for other paths (excluding API, static assets)
        source: '/((?!api|_next/static|_next/image|favicon.ico|blogs).*)',
        headers: [
          {
            key: 'Surrogate-Key',
            value: 'unknown',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
