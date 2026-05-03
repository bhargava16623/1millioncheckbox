import { redis, publisher, subscriber } from './redis-connection.js';
import { checkRateLimit } from './rate-limiter.js';
import { socketAuthMiddleware } from './auth.js';

const CHECKBOX_STATE_KEY = 'checkbox-state';
const ONLINE_USERS_KEY = 'online-users';

// Rate limit config for WebSocket events
const WS_RATE_LIMIT = { maxRequests: 10, windowSec: 30 };

/**
 * Register Socket.io handlers with authentication, rate limiting,
 * Redis Bitmap state management, and Pub/Sub broadcasting.
 */
export async function registerSocketHandlers(io) {
    // Authenticate all socket connections
    io.use(socketAuthMiddleware);

    // Subscribe to Redis Pub/Sub for cross-server sync
    await subscriber.subscribe('internal-server:checkbox:change');
    subscriber.on('message', (channel, message) => {
        if (channel === 'internal-server:checkbox:change') {
            const { index, checked } = JSON.parse(message);
            io.emit('server:checkbox:change', { index, checked });
        }
    });

    io.on('connection', async (socket) => {
        const userId = socket.user.sub;
        console.log('Socket connected', { id: socket.id, user: userId });

        // Track online users using Redis Set
        await redis.sadd(ONLINE_USERS_KEY, userId);
        const onlineCount = await redis.scard(ONLINE_USERS_KEY);
        io.emit('server:online-count', onlineCount);

        // Handle checkbox toggle
        socket.on('client:checkbox:change', async (data) => {
            const { index, checked } = data;

            // Validate input
            if (typeof index !== 'number' || index < 0 || index >= 1_000_000) {
                socket.emit('server:error', { error: 'Invalid checkbox index.' });
                return;
            }
            if (typeof checked !== 'boolean') {
                socket.emit('server:error', { error: 'Invalid checked value.' });
                return;
            }

            // Custom sliding window rate limiting
            const rateResult = await checkRateLimit(`ws:${userId}`, WS_RATE_LIMIT);
            if (!rateResult.allowed) {
                socket.emit('server:error', {
                    error: `Too many changes. ${rateResult.remaining === 0 ? `Try again in ${rateResult.retryAfter}s.` : ''}`,
                });
                return;
            }

            // Update state using Redis Bitmap (1 bit per checkbox)
            await redis.setbit(CHECKBOX_STATE_KEY, index, checked ? 1 : 0);

            // Publish change for other server instances via Pub/Sub
            await publisher.publish(
                'internal-server:checkbox:change',
                JSON.stringify({ index, checked })
            );
        });

        // Handle uncheck all
        socket.on('client:uncheck-all', async () => {
            // Delete the bitmap key — resets all bits to 0
            await redis.del(CHECKBOX_STATE_KEY);
            io.emit('server:uncheck-all');
        });

        // Handle disconnect — remove from online set
        socket.on('disconnect', async () => {
            console.log('Socket disconnected', { id: socket.id, user: userId });
            await redis.srem(ONLINE_USERS_KEY, userId);
            const count = await redis.scard(ONLINE_USERS_KEY);
            io.emit('server:online-count', count);
        });
    });
}

/**
 * Get checkbox states from Redis Bitmap.
 * Returns a Buffer where each bit represents a checkbox.
 */
export async function getCheckboxStates(offset = 0, count = 1000) {
    // Read the relevant byte range from the bitmap
    const startByte = Math.floor(offset / 8);
    const endByte = Math.floor((offset + count - 1) / 8);

    const buffer = await redis.getrangeBuffer(CHECKBOX_STATE_KEY, startByte, endByte);

    // Convert bitmap to boolean array for the requested range
    const result = [];
    for (let i = 0; i < count; i++) {
        const globalIndex = offset + i;
        const byteIndex = Math.floor(globalIndex / 8) - startByte;
        const bitIndex = 7 - (globalIndex % 8); // Bits are stored MSB first
        if (byteIndex < buffer.length) {
            result.push((buffer[byteIndex] >> bitIndex & 1) === 1);
        } else {
            result.push(false);
        }
    }

    return result;
}

/**
 * Get total count of checked checkboxes using BITCOUNT.
 */
export async function getCheckedCount() {
    return await redis.bitcount(CHECKBOX_STATE_KEY);
}
