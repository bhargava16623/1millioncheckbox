import 'dotenv/config';
import Redis from 'ioredis';

function createRedisConnection() {
    return new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
    });
}

export const publisher = createRedisConnection();
export const subscriber = createRedisConnection();
export const redis = createRedisConnection();
