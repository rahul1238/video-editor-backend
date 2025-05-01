const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { connectRedis } = require('./queue/redis');
const videoRoutes = require('./route/videoRoutes');
const { errorHandler } = require('./middleware/errorHandler');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

connectRedis();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/videos', videoRoutes);

app.use(errorHandler);

app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
