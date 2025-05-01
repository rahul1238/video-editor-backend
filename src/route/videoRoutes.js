const express = require('express');
const videoController = require('../controller/videoController');
const upload = require('../middleware/uploadMiddleware'); 

const router = express.Router();


router.post('/upload', upload.single('videoFile'), videoController.uploadVideo);

router.post('/:id/trim', videoController.trimVideo); 

router.post('/:id/subtitles', videoController.addSubtitle); 

router.post('/:id/render', videoController.renderVideo); 

router.get('/:id/download', videoController.downloadVideo); 

module.exports = router; 