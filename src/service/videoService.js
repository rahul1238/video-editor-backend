const prisma = require('../prismaClient');
const ffmpeg = require('fluent-ffmpeg');
const util = require('util');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { getRenderQueue } = require('../queue/renderQueue');

const ffprobe = util.promisify(ffmpeg.ffprobe);

/**
 * Handles video upload, saves metadata to DB and file to storage.
 * @param {object} file - The uploaded file object from Multer.
 * @returns {Promise<object>} - The created video record from the database.
 */
const handleVideoUpload = async (file) => {
    if (!file) {
        throw new Error('No file uploaded.');
    }

    try {
        const metadata = await ffprobe(file.path);
        const duration = metadata.format.duration;

        if (duration === undefined || isNaN(duration)) {
            console.warn(`Could not extract duration for ${file.originalname}. Setting to null.`);
        }

        const videoData = {
            originalName: file.originalname,
            filePath: file.path,
            size: file.size,
            duration: duration ? parseFloat(duration) : null,
            status: 'uploaded',
        };

        const video = await prisma.video.create({
            data: videoData,
        });

        console.log(`Video metadata saved for ${video.originalName} with ID: ${video.id}`);
        return video;
    } catch (error) {
        console.error('Error processing video upload:', error);
        // Clean up the uploaded file if DB insertion fails or ffprobe fails
        if (file && file.path) {
            try {
                await fs.unlink(file.path);
                console.log(`Cleaned up failed upload: ${file.path}`);
            } catch (unlinkError) {
                console.error(`Error cleaning up file ${file.path}:`, unlinkError);
            }
        }
        throw new Error(`Failed to process uploaded video: ${error.message}`);
    }
};

/**
 * Trims a video based on start and end times.
 * @param {string} videoId - The ID of the video to trim.
 * @param {number} startTime - Start time in seconds.
 * @param {number} endTime - End time in seconds.
 * @returns {Promise<object>} - The updated video record.
 */
const trimVideo = async (videoId, startTime, endTime) => {
    const video = await prisma.video.findUnique({
        where: { id: videoId },
    });

    if (!video) {
        throw new Error(`Video with ID ${videoId} not found.`);
    }

    if (!video.filePath) {
        throw new Error(`Original file path not found for video ID ${videoId}.`);
    }

    if (startTime < 0 || endTime <= startTime || (video.duration && endTime > video.duration)) {
        throw new Error('Invalid start or end time.');
    }

    const originalPathInfo = path.parse(video.filePath);
    const outputFileName = `${originalPathInfo.name}-trimmed-${Date.now()}${originalPathInfo.ext}`;
    const outputPath = path.join(path.dirname(video.filePath), outputFileName);

    await prisma.video.update({
        where: { id: videoId },
        data: { status: 'processing' },
    });

    console.log(`Trimming video ${videoId} from ${startTime}s to ${endTime}s...`);

    return new Promise((resolve, reject) => {
        ffmpeg(video.filePath)
            .setStartTime(startTime)
            .setDuration(endTime - startTime)
            .output(outputPath)
            .on('end', async (stdout, stderr) => {
                console.log(`Trimming finished for ${videoId}. Output: ${outputPath}`);
                try {
                    const stats = await fs.stat(outputPath);
                    if (!stats.size) {
                        throw new Error('Trimmed file is empty.');
                    }

                    const updatedVideo = await prisma.video.update({
                        where: { id: videoId },
                        data: {
                            trimmedFilePath: outputPath,
                            status: 'trimmed',
                        },
                    });
                    resolve(updatedVideo);
                } catch (dbError) {
                    console.error(`Error updating database after trimming ${videoId}:`, dbError);
                    try { await fs.unlink(outputPath); } catch (e) { console.error('Failed to cleanup trimmed file:', e); }
                    await prisma.video.update({
                        where: { id: videoId },
                        data: { status: 'failed' },
                    });
                    reject(new Error(`Database update failed after trimming: ${dbError.message}`));
                }
            })
            .on('error', async (err, stdout, stderr) => {
                console.error(`Error during trimming process for ${videoId}:`, err.message);
                console.error('ffmpeg stderr:', stderr);
                await prisma.video.update({
                    where: { id: videoId },
                    data: { status: 'failed' },
                });
                reject(new Error(`FFmpeg trimming failed: ${err.message}`));
            })
            .run();
    });
};

/**
 * Generates an ASS subtitle string.
 * Basic implementation, can be expanded for more styling.
 */
const generateAssSubtitle = (text, startTime, endTime, videoWidth, videoHeight) => {
    let assContent = `[Script Info]
Title: Generated Subtitle
ScriptType: v4.00+
PlayResX: ${videoWidth || 1280} 
PlayResY: ${videoHeight || 720}

`;
    assContent += `[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1

`;
    assContent += `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const formatTime = (seconds) => {
        const date = new Date(0);
        date.setSeconds(seconds);
        return date.toISOString().substr(12, 10); 
    };

    const startStr = formatTime(startTime);
    const endStr = formatTime(endTime);

    assContent += `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${text}
`;

    return assContent;
};

/**
 * Adds subtitles to a video.
 * @param {string} videoId - The ID of the video.
 * @param {string} text - The subtitle text.
 * @param {number} startTime - Start time for the subtitle.
 * @param {number} endTime - End time for the subtitle.
 * @returns {Promise<object>} - The updated video record.
 */
const addSubtitleToVideo = async (videoId, text, startTime, endTime) => {
    const video = await prisma.video.findUnique({ where: { id: videoId } });

    if (!video) throw new Error(`Video with ID ${videoId} not found.`);

    const inputPath = video.trimmedFilePath || video.filePath; 
    if (!inputPath) throw new Error(`No video file path found for video ID ${videoId}.`);

    if (video.duration && (startTime < 0 || endTime <= startTime || endTime > video.duration)) {
        throw new Error('Invalid start or end time for subtitle.');
    }

    let videoWidth, videoHeight;
    try {
        const metadata = await ffprobe(inputPath);
        const stream = metadata.streams.find(s => s.codec_type === 'video');
        if (stream) {
            videoWidth = stream.width;
            videoHeight = stream.height;
        }
    } catch (probeError) {
        console.warn(`Could not probe video dimensions for ${videoId}:`, probeError.message);
    }

    const assContent = generateAssSubtitle(text, startTime, endTime, videoWidth, videoHeight);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-'));
    const subtitleFilePath = path.join(tempDir, `subtitle-${Date.now()}.ass`);
    await fs.writeFile(subtitleFilePath, assContent);

    const originalPathInfo = path.parse(inputPath);
    const outputFileName = `${originalPathInfo.name}-subtitled-${Date.now()}${originalPathInfo.ext}`;
    const outputPath = path.join(path.dirname(video.filePath), outputFileName);

    await prisma.video.update({ where: { id: videoId }, data: { status: 'processing' } });

    console.log(`Adding subtitle to video ${videoId}...`);

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .videoFilters({
                filter: 'subtitles',
                options: subtitleFilePath
            })
            .output(outputPath)
            .on('end', async () => {
                console.log(`Subtitles added for ${videoId}. Output: ${outputPath}`);
                try {
                    const stats = await fs.stat(outputPath);
                    if (!stats.size) throw new Error('Subtitled file is empty.');

                    const updatedVideo = await prisma.video.update({
                        where: { id: videoId },
                        data: {
                            subtitledFilePath: outputPath,
                            status: 'subtitled'
                        },
                    });
                    resolve(updatedVideo);
                } catch (dbError) {
                    console.error(`Error updating database after adding subtitles ${videoId}:`, dbError);
                    try { await fs.unlink(outputPath); } catch (e) { console.error('Failed to cleanup subtitled file:', e); }
                    await prisma.video.update({ where: { id: videoId }, data: { status: 'failed' } });
                    reject(new Error(`Database update failed after adding subtitles: ${dbError.message}`));
                } finally {
                    try {
                        await fs.unlink(subtitleFilePath);
                        await fs.rmdir(tempDir);
                    } catch (cleanupError) {
                        console.warn(`Failed to cleanup temporary subtitle files for ${videoId}:`, cleanupError);
                    }
                }
            })
            .on('error', async (err, stdout, stderr) => {
                console.error(`Error adding subtitles for ${videoId}:`, err.message);
                console.error('ffmpeg stderr:', stderr);
                try {
                    await fs.unlink(subtitleFilePath);
                    await fs.rmdir(tempDir);
                } catch (cleanupError) {
                    console.warn(`Failed to cleanup temporary subtitle files on error for ${videoId}:`, cleanupError);
                }
                await prisma.video.update({ where: { id: videoId }, data: { status: 'failed' } });
                reject(new Error(`FFmpeg subtitle process failed: ${err.message}`));
            })
            .run();
    });
};

/**
 * Queues a job to render the final video.
 * @param {string} videoId - The ID of the video to render.
 * @returns {Promise<{jobId: string, video: object}>} - Job ID and updated video record.
 */
const queueRenderJob = async (videoId) => {
    const video = await prisma.video.findUnique({ where: { id: videoId } });

    if (!video) throw new Error(`Video with ID ${videoId} not found.`);

    if (['rendering', 'completed'].includes(video.status)) {
        throw new Error(`Video ${videoId} is already ${video.status} or being rendered.`);
    }

    const sourcePath = video.subtitledFilePath || video.trimmedFilePath || video.filePath;
    if (!sourcePath) {
        throw new Error(`No source file path found to render for video ${videoId}.`);
    }

    const updatedVideo = await prisma.video.update({
        where: { id: videoId },
        data: { status: 'rendering' },
    });

    const queue = getRenderQueue();
    const job = await queue.add('render-video', { videoId });

    console.log(`Queued render job ${job.id} for video ${videoId}`);

    return { jobId: job.id, video: updatedVideo };
};

/**
 * Gets the path of the final rendered video file for download.
 * @param {string} videoId - The ID of the video.
 * @returns {Promise<string>} - The absolute path to the rendered video file.
 */
const getDownloadPath = async (videoId) => {
    const video = await prisma.video.findUnique({ where: { id: videoId } });

    if (!video) throw new Error(`Video with ID ${videoId} not found.`);
    if (video.status !== 'completed') throw new Error(`Video ${videoId} is not yet completed. Current status: ${video.status}`);
    if (!video.renderedFilePath) throw new Error(`Rendered file path not found for completed video ${videoId}.`);

    try {
        await fs.access(video.renderedFilePath);
        return video.renderedFilePath;
    } catch (error) {
        console.error(`Rendered file not found at path: ${video.renderedFilePath}`);
        throw new Error(`Rendered file for video ${videoId} is missing.`);
    }
};

module.exports = {
    handleVideoUpload,
    trimVideo,
    addSubtitleToVideo,
    queueRenderJob,
    getDownloadPath,
};
