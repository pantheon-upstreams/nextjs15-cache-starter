import type { BlogPost } from '../app/blogs/page';

// WordPress REST API base URL — customers replace this with their own WordPress site
const WP_API_URL = process.env.WORDPRESS_API_URL || 'https://developer.wordpress.org/news/wp-json/wp/v2';

/**
 * Strip HTML tags from WordPress rendered fields (title, excerpt, etc.)
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Estimate reading time from text content (stripping HTML first)
 */
function calculateReadingTime(html: string): number {
  const text = stripHtml(html);
  const wordsPerMinute = 200;
  const words = text.split(/\s+/).length;
  return Math.ceil(words / wordsPerMinute);
}

/**
 * Transform a WordPress REST API post (with _embed) into our BlogPost structure.
 */
function transformWordPressPost(wpPost: any): BlogPost {
  const authorData = wpPost._embedded?.author?.[0];
  // wp:term[0] = categories, wp:term[1] = tags in a standard WP setup
  const wpTags = wpPost._embedded?.['wp:term']?.flat()?.filter((t: any) => t.taxonomy === 'post_tag') || [];
  const wpCategories = wpPost._embedded?.['wp:term']?.flat()?.filter((t: any) => t.taxonomy === 'category') || [];
  const termNames = [...wpCategories, ...wpTags].map((t: any) => t.name);

  return {
    id: wpPost.id,
    userId: wpPost.author,
    title: stripHtml(wpPost.title.rendered),
    body: wpPost.content.rendered,
    slug: wpPost.slug,
    excerpt: stripHtml(wpPost.excerpt.rendered),
    author: {
      name: authorData?.name || 'Unknown',
      email: '',
      website: authorData?.url || '',
    },
    publishedAt: wpPost.date,
    readingTime: calculateReadingTime(wpPost.content.rendered),
    tags: termNames.length > 0 ? termNames : ['General'],
  };
}

/**
 * Get all blog posts from WordPress using Next.js fetch caching
 */
export async function getBlogPosts(): Promise<BlogPost[]> {
  try {
    console.log('[API] Fetching blog posts from WordPress...');

    const response = await fetch(`${WP_API_URL}/posts?_embed&per_page=10`, {
      next: {
        revalidate: 300, // 5 minutes
        tags: ['api-posts', 'external-data']
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch posts from WordPress: ${response.status}`);
    }

    const wpPosts = await response.json();
    const posts = wpPosts.map(transformWordPressPost);

    console.log(`[API] Successfully fetched ${posts.length} posts from WordPress`);
    return posts;

  } catch (error) {
    console.error('[API] Error fetching blog posts:', error);
    return [];
  }
}

/**
 * Get a single blog post by slug from WordPress using Next.js fetch caching
 */
export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  try {
    console.log(`[API] Fetching blog post: ${slug}`);

    const response = await fetch(`${WP_API_URL}/posts?slug=${encodeURIComponent(slug)}&_embed`, {
      next: {
        revalidate: 600, // 10 minutes cache for individual posts
        tags: [`post-${slug}`, 'api-posts']
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch post from WordPress: ${response.status}`);
    }

    const wpPosts = await response.json();

    if (wpPosts.length === 0) {
      console.log(`[API] Post not found: ${slug}`);
      return null;
    }

    const post = transformWordPressPost(wpPosts[0]);
    console.log(`[API] Successfully fetched post: ${post.title}`);
    return post;

  } catch (error) {
    console.error(`[API] Error fetching blog post ${slug}:`, error);
    return null;
  }
}

// ==================== API ROUTE CACHE TESTING FUNCTIONS ====================

/**
 * Fetch posts with no-store cache strategy
 */
export async function fetchPostsWithNoCache(): Promise<any[]> {
  console.log('[BlogService] Fetching posts with no-store cache...');

  const response = await fetch(`${WP_API_URL}/posts?_embed&per_page=3`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error('Failed to fetch posts');
  }

  const posts = await response.json();
  console.log(`[BlogService] Fetched ${posts.length} posts with no-store`);
  return posts;
}

/**
 * Fetch posts with force-cache strategy
 */
export async function fetchPostsWithForceCache(): Promise<any[]> {
  console.log('[BlogService] Fetching posts with force-cache...');

  const response = await fetch(`${WP_API_URL}/posts?_embed&per_page=3`, {
    cache: 'force-cache'
  });

  if (!response.ok) {
    throw new Error('Failed to fetch posts');
  }

  const posts = await response.json();
  console.log(`[BlogService] Fetched ${posts.length} posts with force-cache`);
  return posts;
}

/**
 * Fetch posts with revalidate strategy
 */
export async function fetchPostsWithRevalidate(): Promise<any[]> {
  console.log('[BlogService] Fetching posts with 60s revalidation...');

  const response = await fetch(`${WP_API_URL}/posts?_embed&per_page=3`, {
    next: { revalidate: 60 }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch posts');
  }

  const posts = await response.json();
  console.log(`[BlogService] Fetched ${posts.length} posts with 60s revalidation`);
  return posts;
}

/**
 * Fetch posts with tagged cache strategy
 */
export async function fetchPostsWithTags(): Promise<any[]> {
  console.log('[BlogService] Fetching posts with cache tags...');

  const response = await fetch(`${WP_API_URL}/posts?_embed&per_page=3`, {
    next: {
      revalidate: 300, // 5 minutes
      tags: ['api-posts', 'external-data']
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch posts');
  }

  const posts = await response.json();
  console.log(`[BlogService] Fetched ${posts.length} posts with tagged cache`);
  return posts;
}
