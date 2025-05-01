const { Queue } = require('bullmq');
const { getRedisClient } = require('./redis');

const QUEUE_NAME = 'video-render';

let renderQueue;

function getRenderQueue() {
    if (!renderQueue) {
        const redisClient = getRedisClient(); 
        if (!redisClient) {
            throw new Error('Redis connection not available for BullMQ queue.');
        }
        
        renderQueue = new Queue(QUEUE_NAME, {
            connection: redisClient,
            defaultJobOptions: {
                attempts: 3, 
                backoff: {
                    type: 'exponential',
                    delay: 5000, 
                },
                removeOnComplete: true, 
                removeOnFail: 50 
            }
        });

        console.log(`BullMQ queue '${QUEUE_NAME}' initialized.`);
    }
    return renderQueue;
}

module.exports = { getRenderQueue, QUEUE_NAME }; 