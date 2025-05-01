const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { connectRedis } = require('./queue/redis');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

connectRedis();

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
