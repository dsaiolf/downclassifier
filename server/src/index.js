import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import FormData from 'form-data';
import authRoutes from './routes/authRoutes.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Upstream config ───────────────────────────────────────────────────
const SAGEMAKER_API_KEY = process.env.SAGEMAKER_API_KEY;
const DOMAIN_ID         = process.env.DOMAIN_ID  || 'd-tcyd6dgiuilt';
const STAGE             = process.env.STAGE       || 'dev';
const ENDPOINT          = process.env.ENDPOINT    || 'd2';
const S3_PREFIX         = process.env.S3_PREFIX   || 'd2/uploads';
const S3_LOG_ROOT       = 'd2_logs';

const GATEWAY_URL = `https://api-sagemaker.analytics.gov.sg/v2/${DOMAIN_ID}/${STAGE}/${ENDPOINT}/predict`;
const UPLOAD_URL  = `https://api-sagemaker.analytics.gov.sg/v2/s3/domain_id/${DOMAIN_ID}/stage/${STAGE}/upload`;
const S3_BASE_URL = `https://api-sagemaker.analytics.gov.sg/v2/s3/domain_id/${DOMAIN_ID}/stage/${STAGE}?key=`;

// ── In-memory job store ───────────────────────────────────────────────
// { status, result, error, startedAt, lastStage }
const jobs = new Map();

// ── Helpers ───────────────────────────────────────────────────────────

async function s3Exists(key) {
  const r = await fetch(`${S3_BASE_URL}${key}`, {
    headers: { 'x-api-key': SAGEMAKER_API_KEY },
  });
  return { ok: r.ok, status: r.status, res: r };
}

// ── Middleware ────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:4173',
    'https://downclassifier.app.tc1.airbase.sg',
  ],
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use('/api/auth', authRoutes);

const upload = multer({ storage: multer.memoryStorage() });

// ── Routes ────────────────────────────────────────────────────────────

app.post('/api/maestro', async (req, res) => {
  const method = req.body?.method;
  console.log('[maestro] method:', method);

  if (method === 'analyse') {
    try {
      // Gateway now returns immediately with jobid — pipeline runs in background
      const upstream = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'x-api-key': SAGEMAKER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      const data = await upstream.json().catch(() => ({}));
      console.log('[maestro] analyse upstream response:', data);

      if (!upstream.ok || data.error) {
        return res.status(upstream.status || 500).json({ error: data.error || 'Upstream failed' });
      }

      const jobid = data.jobid;
      if (!jobid) {
        console.error('[maestro] upstream did not return a jobid — response:', data);
        return res.status(500).json({ error: 'Upstream did not return a jobid' });
      }

      jobs.set(jobid, {
        status: 'running', result: null, error: null,
        startedAt: new Date(),
      });
      console.log(`[maestro] job ${jobid} registered`);

      return res.json({ jobid });

    } catch (err) {
      console.error('[maestro] analyse error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // All other methods — proxy as before
  try {
    const upstream = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'x-api-key': SAGEMAKER_API_KEY, 'Content-Type': 'application/json' },
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

// Poll job status — checks one stage file at a time, advancing forward
app.get('/api/maestro/status/:jobid', async (req, res) => {
  const { jobid } = req.params;
  const job = jobs.get(jobid);

  console.log(`[status] jobid=${jobid} current=${job?.status ?? 'not found'}`);

  if (!job)                      return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'failed')   return res.json({ status: 'failed', error: job.error });
  if (job.status === 'complete') return res.json({ status: 'complete', result: job.result });

  try {
    const { ok: finalOk, res: finalRes } = await s3Exists(`${S3_LOG_ROOT}/${jobid}/final_output.json`);
    console.log(`[status] final_output.json → ${finalRes.status}`);

    if (finalOk) {
      const result = await finalRes.json();
      jobs.set(jobid, { ...job, status: 'complete', result });
      console.log(`[status] jobid=${jobid} → complete`);
      return res.json({ status: 'complete', result });
    }

    return res.json({ status: 'running', label: 'Analysing document…' });

  } catch (err) {
    console.error(`[status] jobid=${jobid} S3 check error:`, err.message);
    return res.json({ status: 'running', label: 'Analysing document…' });
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
      method: 'POST',
      headers: { 'x-api-key': SAGEMAKER_API_KEY, ...form.getHeaders() },
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

// List all past runs
app.get('/api/past-runs', async (req, res) => {
  try {
    const upstream = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'x-api-key': SAGEMAKER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'list_runs' }),
    });
    const data = await upstream.json().catch(() => ({}));
    console.log('[past-runs] runs:', data.runs?.length ?? 'error');
    res.json(data);
  } catch (err) {
    console.error('[past-runs] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get a specific past run's result
app.get('/api/past-runs/:jobid', async (req, res) => {
  const { jobid } = req.params;
  try {
    const upstream = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'x-api-key': SAGEMAKER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'get_run', jobid }),
    });
    const data = await upstream.json().catch(() => ({}));
    console.log(`[past-runs] get ${jobid} → ${data.status ?? 'error'}`);
    res.json(data);
  } catch (err) {
    console.error(`[past-runs] get ${jobid} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`D2 server running on port ${PORT}`));