import { redis } from './redis-connection.js';

/**
 * Sliding Window Rate Limiter using Redis
 * Allows `maxRequests` operations within `windowSec` seconds.
 * Uses a counter with TTL expiry per user/identifier.
 */
export async function checkRateLimit(identifier, { maxRequests = 10, windowSec = 30 } = {}) {
    const key = `rate-limit:${identifier}`;

    const current = await redis.incr(key);

    // Set expiry only on first request in the window
    if (current === 1) {
        await redis.expire(key, windowSec);
    }

    if (current > maxRequests) {
        const ttl = await redis.ttl(key);
        return {
            allowed: false,
            remaining: 0,
            retryAfter: ttl,
            message: `Rate limit exceeded. Try again in ${ttl} seconds.`,
        };
    }

    return {
        allowed: true,
        remaining: maxRequests - current,
        retryAfter: 0,
    };
}

/**
 * HTTP Rate Limiter Middleware
 * Apply to Express routes for API rate limiting.
 */
export function httpRateLimiter({ maxRequests = 20, windowSec = 60, keyFn } = {}) {
    return async (req, res, next) => {
        // Use user ID if authenticated, otherwise IP
        const identifier = keyFn
            ? keyFn(req)
            : (req.user?.sub || req.ip);

        const result = await checkRateLimit(`http:${identifier}`, { maxRequests, windowSec });

        res.set('X-RateLimit-Limit', String(maxRequests));
        res.set('X-RateLimit-Remaining', String(result.remaining));

        if (!result.allowed) {
            res.set('Retry-After', String(result.retryAfter));
            return res.status(429).json({ error: result.message });
        }

        next();
    };
}
