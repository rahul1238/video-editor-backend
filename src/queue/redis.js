const IORedis = require('ioredis');

let redisClient;

function connectRedis() {
    if (!process.env.REDIS_URL) {
        console.error('REDIS_URL is not defined in the environment variables.');
        process.exit(1);
    }
    redisClient = new IORedis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null
    });

    redisClient.on('connect', () => {
        console.log('Connected to Redis');
    });

    redisClient.on('error', (err) => {
        console.error('Redis connection error:', err);
    });

    return redisClient;
}

function getRedisClient() {
    if (!redisClient) {
        throw new Error('Redis client not initialized. Call connectRedis first.');
    }
    return redisClient;
}

module.exports = { connectRedis, getRedisClient }; 