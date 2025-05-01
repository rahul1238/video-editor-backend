require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs').promises;
const prisma = require('../db/prismaClient');
const { getRedisClient, connectRedis } = require('../queue/redis');
const { QUEUE_NAME } = require('../queue/renderQueue');

const RENDER_SIMULATION_DELAY_MS = 10000;

console.log('Worker starting...');
console.log(`Attempting Redis connection using URL: ${process.env.REDIS_URL}`);

connectRedis();
const redisClient = getRedisClient();

if (!redisClient) {
    console.error('Failed to get Redis client.');
    process.exit(1);
}

const worker = new Worker(QUEUE_NAME, async (job) => {
    const { videoId } = job.data;
    console.log(`[Worker] Processing job ${job.id} for video ID: ${videoId}`);

    try {
        const video = await prisma.video.findUnique({ where: { id: videoId } });
        if (!video) throw new Error(`Video ${videoId} not found.`);

        if (video.status === 'completed') {
            console.log(`[Worker] Video ${videoId} already completed. Skipping job ${job.id}.`);
            return { status: 'skipped', message: 'Already completed' };
        }

        const sourcePath = video.subtitledFilePath || video.trimmedFilePath || video.filePath;
        if (!sourcePath) throw new Error(`No source file path found for video ${videoId}.`);

        const sourcePathInfo = path.parse(sourcePath);
        const outputFileName = `${sourcePathInfo.name.replace('-subtitled', '').replace('-trimmed', '')}-rendered${sourcePathInfo.ext}`;
        const outputPath = path.join(path.dirname(video.filePath), outputFileName);

        console.log(`[Worker] Simulating render for ${RENDER_SIMULATION_DELAY_MS / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, RENDER_SIMULATION_DELAY_MS));

        console.log(`[Worker] Copying ${sourcePath} to ${outputPath}...`);
        await fs.copyFile(sourcePath, outputPath);
        console.log(`[Worker] File copied successfully.`);

        const updatedVideo = await prisma.video.update({
            where: { id: videoId },
            data: {
                status: 'completed',
                renderedFilePath: outputPath,
            },
        });

        console.log(`[Worker] Job ${job.id} completed for video ${videoId}.`);

        const pathsToDelete = [
            video.filePath,
            video.trimmedFilePath,
            video.subtitledFilePath
        ].filter(p => p && p !== outputPath);

        for (const filePathToDelete of pathsToDelete) {
            try {
                await fs.unlink(filePathToDelete);
                console.log(`[Worker] Deleted intermediate file: ${filePathToDelete}`);
            } catch (unlinkError) {
                console.warn(`[Worker] Failed to delete intermediate file ${filePathToDelete}: ${unlinkError.message}`);
            }
        }

        return { status: 'success', renderedPath: outputPath };

    } catch (error) {
        console.error(`[Worker] Job ${job.id} failed for video ID: ${videoId}. Error: ${error.message}`);
        console.error(error.stack);

        try {
            await prisma.video.update({
                where: { id: videoId },
                data: { status: 'failed' },
            });
            console.log(`[Worker] Marked video ${videoId} as 'failed' in DB.`);
        } catch (dbError) {
            console.error(`[Worker] Failed to update video ${videoId} status to 'failed': ${dbError.message}`);
        }

        throw error;
    }
}, {
    connection: redisClient,
    concurrency: 5,
    limiter: {
        max: 10,
        duration: 1000,
    },
});

worker.on('completed', (job, result) => {
    console.log(`[Worker] Job ${job.id} completed successfully. Result:`, result);
});

worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} failed with error: ${err.message}`);
});

worker.on('error', err => {
    console.error('[Worker] Error:', err);
});

console.log('Render worker listening for jobs...');

process.on('SIGINT', async () => {
    console.log('Worker shutting down...');
    await worker.close();
    console.log('Worker closed.');
    process.exit(0);
});