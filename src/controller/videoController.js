const videoService = require('../service/videoService');

/**
 * Controller for handling video uploads.
 */
const uploadVideo = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No video file provided.' });
        }

        console.log('Received file:', req.file.originalname);

        const video = await videoService.handleVideoUpload(req.file);

        res.status(201).json({
            success: true,
            message: 'Video uploaded successfully!',
            data: video,
        });
    } catch (error) {
        console.error('Upload controller error:', error);
        next(error);
    }
};

/**
 * Controller for trimming a video.
 */
const trimVideo = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { startTime, endTime } = req.body;

        if (startTime === undefined || endTime === undefined) {
            return res.status(400).json({ success: false, message: 'startTime and endTime are required in the request body.' });
        }

        const start = parseFloat(startTime);
        const end = parseFloat(endTime);

        if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
            return res.status(400).json({ success: false, message: 'Invalid startTime or endTime format/values.' });
        }

        console.log(`Received trim request for video ${id}: start=${start}, end=${end}`);

        const updatedVideo = await videoService.trimVideo(id, start, end);

        res.status(200).json({
            success: true,
            message: 'Video trimming started successfully.',
            data: updatedVideo,
        });

    } catch (error) {
        console.error('Trim controller error:', error);
        next(error);
    }
};

/**
 * Controller for adding a subtitle to a video.
 */
const addSubtitle = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { text, startTime, endTime } = req.body;

        if (!text || startTime === undefined || endTime === undefined) {
            return res.status(400).json({ success: false, message: 'text, startTime, and endTime are required in the request body.' });
        }

        const start = parseFloat(startTime);
        const end = parseFloat(endTime);

        if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
            return res.status(400).json({ success: false, message: 'Invalid startTime or endTime format/values.' });
        }

        console.log(`Received subtitle request for video ${id}: start=${start}, end=${end}, text="${text.substring(0, 30)}..."`);

        const updatedVideo = await videoService.addSubtitleToVideo(id, text, start, end);

        res.status(200).json({
            success: true,
            message: 'Subtitle added successfully.',
            data: updatedVideo,
        });

    } catch (error) {
        console.error('Subtitle controller error:', error);
        next(error);
    }
};

/**
 * Controller for queueing a final render job.
 */
const renderVideo = async (req, res, next) => {
    try {
        const { id } = req.params;
        console.log(`Received render request for video ${id}`);

        const { jobId, video } = await videoService.queueRenderJob(id);

        res.status(202).json({ 
            success: true,
            message: `Render job queued successfully for video ${id}.`,
            jobId: jobId,
            data: { status: video.status },
        });

    } catch (error) {
        console.error('Render controller error:', error);
        if (error.message.includes('already') || error.message.includes('No source file')) {
            return res.status(409).json({ success: false, message: error.message }); 
        }
        if (error.message.includes('not found')) {
            return res.status(404).json({ success: false, message: error.message });
        }
        next(error);
    }
};

/**
 * Controller for downloading the final rendered video.
 */
const downloadVideo = async (req, res, next) => {
    try {
        const { id } = req.params;
        console.log(`Received download request for video ${id}`);

        const filePath = await videoService.getDownloadPath(id);

        console.log(`Sending file for download: ${filePath}`);

        res.download(filePath, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                if (!res.headersSent) {
                    if (err.message.includes('not found') || err.message.includes('missing')) {
                        return res.status(404).json({ success: false, message: 'Rendered file not found or is missing.' });
                    }
                    if (err.message.includes('not yet completed')) {
                        return res.status(409).json({ success: false, message: 'Video rendering not complete.'});
                    }
                    next(err);
                } else {
                    console.error('Error occurred during file streaming, connection likely closed.');
                }
            }
        });

    } catch (error) {
        console.error('Download controller error:', error);
        if (error.message.includes('not found') || error.message.includes('missing')) {
            return res.status(404).json({ success: false, message: error.message });
        }
        if (error.message.includes('not yet completed')) {
            return res.status(409).json({ success: false, message: error.message });
        }
        next(error);
    }
};

module.exports = {
    uploadVideo,
    trimVideo,
    addSubtitle,
    renderVideo,
    downloadVideo,
}; 