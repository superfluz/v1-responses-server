import 'dotenv/config';
import cors from 'cors';
import express from 'express';

import responsesRouter from './routes/route.js';

const app = express();
const port = process.env.PORT || 3000;
const allowedOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} tidak diizinkan CORS`));
    }
  })
);
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    name: 'v1-responses-server',
    status: 'ok',
    // Date ke format id-ID
    Date: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    version: '1.0.0'
  });
});

app.use('/api/responses', responsesRouter);

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: 'JSON body tidak valid',
      detail: error.message
    });
  }

  if (error.message?.includes('tidak diizinkan CORS')) {
    return res.status(403).json({
      error: 'Origin tidak diizinkan CORS',
      detail: error.message
    });
  }

  next(error);
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
