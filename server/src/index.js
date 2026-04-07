import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import FormData from 'form-data';
import authRoutes from './routes/authRoutes.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Upstream config (kept server-side only) ───────────────────────────
const SAGEMAKER_API_KEY = process.env.SAGEMAKER_API_KEY;
const DOMAIN_ID         = process.env.DOMAIN_ID  || 'd-tcyd6dgiuilt';
const STAGE             = process.env.STAGE       || 'dev';
const ENDPOINT          = process.env.ENDPOINT    || 'd2';
const S3_PREFIX         = process.env.S3_PREFIX   || 'd2/uploads';

const GATEWAY_URL = `https://api-sagemaker.analytics.gov.sg/v2/${DOMAIN_ID}/${STAGE}/${ENDPOINT}/predict`;
const UPLOAD_URL  = `https://api-sagemaker.analytics.gov.sg/v2/s3/domain_id/${DOMAIN_ID}/stage/${STAGE}/upload`;

// ── Middleware ────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173', // dev server
    'http://localhost:4173', // preview
    'https://downclassifier.app.tc1.airbase.sg',
  ],
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

app.use('/api/auth', authRoutes);

const upload = multer({ storage: multer.memoryStorage() });

// ── Routes ────────────────────────────────────────────────────────────

// Proxy: registry + analyse calls to SageMaker gateway
app.post('/api/maestro', async (req, res) => {
  console.log('[maestro] method:', req.body?.method);
  try {
    const upstream = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'x-api-key': SAGEMAKER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json().catch(() => ({}));
    console.log('[maestro] upstream status:', upstream.status);
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[maestro] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Proxy: PDF upload to S3
app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('[upload] file:', req.file?.originalname, '| key:', req.body?.key);
  try {
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename:    req.file.originalname,
      contentType: req.file.mimetype,
    });
    form.append('key', req.body.key);

    const upstream = await fetch(UPLOAD_URL, {
      method:  'POST',
      headers: {
        'x-api-key': SAGEMAKER_API_KEY,
        ...form.getHeaders(),
      },
      body: form.getBuffer(),
    });

    const data = await upstream.json().catch(() => ({}));
    console.log('[upload] upstream status:', upstream.status);
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[upload] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`D2 server running on port ${PORT}`));
