import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

const UNAUTHORIZED_RESPONSE = NextResponse.json(
  { error: 'Unauthorized. Provide a valid secret via Authorization header or x-webhook-secret header.' },
  { status: 401 }
);

/**
 * Validate the request against the WEBHOOK_SECRET env var.
 * Accepts the secret via `Authorization: Bearer <secret>` or `x-webhook-secret: <secret>`.
 */
function isAuthorized(request: NextRequest): boolean {
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('[API] /api/purge - WEBHOOK_SECRET is not configured. All requests will be rejected.');
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (token === webhookSecret) {
      return true;
    }
  }

  const secretHeader = request.headers.get('x-webhook-secret');
  if (secretHeader === webhookSecret) {
    return true;
  }

  return false;
}

/**
 * Parse surrogate keys from the request body.
 * Accepts either a single string or an array of strings.
 */
function parseSurrogateKeys(body: any): string[] {
  const { surrogateKeys } = body;

  if (!surrogateKeys) {
    return [];
  }

  if (typeof surrogateKeys === 'string') {
    return [surrogateKeys];
  }

  if (Array.isArray(surrogateKeys)) {
    return surrogateKeys.filter((key): key is string => typeof key === 'string' && key.length > 0);
  }

  return [];
}

/**
 * POST /api/purge
 *
 * Secured endpoint that accepts a single surrogate key or a list and calls
 * revalidateTag() for each, triggering edge cache clearing.
 *
 * Authentication (one of):
 *   Authorization: Bearer <WEBHOOK_SECRET>
 *   x-webhook-secret: <WEBHOOK_SECRET>
 *
 * Body formats:
 *   { "surrogateKeys": "blog-my-post" }
 *   { "surrogateKeys": ["blog-my-post", "blog-index"] }
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    console.warn('[API] /api/purge - Unauthorized request rejected');
    return UNAUTHORIZED_RESPONSE;
  }

  try {
    const body = await request.json();
    const keys = parseSurrogateKeys(body);

    if (keys.length === 0) {
      return NextResponse.json(
        {
          error: 'surrogateKeys is required. Provide a string or array of strings.',
          example: { surrogateKeys: ['blog-my-post', 'blog-index'] }
        },
        { status: 400 }
      );
    }

    console.log(`[API] /api/purge - Purging ${keys.length} surrogate key(s): ${keys.join(', ')}`);

    for (const key of keys) {
      revalidateTag(key);
    }

    return NextResponse.json({
      message: `Purged ${keys.length} surrogate key(s)`,
      purged_keys: keys,
      purged_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[API] /api/purge - Error:', error);

    return NextResponse.json(
      { error: 'Failed to purge surrogate keys' },
      { status: 500 }
    );
  }
}
