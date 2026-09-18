import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { resolveKickUrl, proxyHlsRequest } from './server/kickService.js';
import { analyzeVodHighlights } from './server/geminiService.js';
import { analyzeVodAcoustics } from './server/vodAnalysisService.js';
import {
  startExportJob,
  getExportJob,
  cancelExportJob,
  getExportFilePath,
} from './server/exportService.js';

const PORT = 3000;
const app = express();
app.set('trust proxy', true);

// Temporary directory for uploaded video files
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads_temp');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage setup (up to 50 GB as required)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${cleanName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 * 1024, // 50 GB
  },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(mp4|mkv|mov|webm|ts|m4v|avi|flv)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de video no compatible. Formatos permitidos: MP4, MKV, MOV, WebM, TS.'));
    }
  },
});

// Basic in-memory rate limiting per IP to prevent CPU overload and abuse
interface RateRecord {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateRecord>();

function rateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = rateLimits.get(ip);

    if (!record || now > record.resetAt) {
      rateLimits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      return res.status(429).json({
        error: 'Demasiadas solicitudes. Por favor, espera unos momentos antes de reintentar.',
      });
    }

    record.count++;
    next();
  };
}

// Global Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security Headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Serve uploaded videos statically with range support for seeking
app.use('/uploads', express.static(UPLOADS_DIR));

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'VELORA',
    version: '1.0.0-prod',
    uptime: process.uptime(),
  });
});

/**
 * Resolve Kick VOD or stream URL
 */
app.post('/api/kick/resolve', rateLimiter(60, 60 * 1000), async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'La URL del video o transmisión es obligatoria.' });
    }

    const resolved = await resolveKickUrl(url);
    res.json(resolved);
  } catch (err: any) {
    console.error('Error resolving Kick URL:', err);
    res.status(500).json({ error: err.message || 'Error al resolver el VOD de Kick.' });
  }
});

/**
 * Proxy HLS playlist and video segments to bypass CORS restrictions
 */
app.options('/api/kick/proxy', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.sendStatus(204);
});

app.get('/api/kick/proxy', async (req, res) => {
  // Always attach CORS headers so browsers never block error responses or segments
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).type('text/plain').send('HLS Proxy Error (400): Falta el parámetro url');
  }

  // Security: prevent file system / localhost traversal
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return res.status(403).type('text/plain').send('HLS Proxy Error (403): Protocolo no permitido');
  }

  try {
    // Use relative path so HLS manifests work seamlessly in browser regardless of host/protocol/proxy
    const proxyBase = '/api/kick/proxy';
    const { statusCode, contentType, headers: customHeaders, data } = await proxyHlsRequest(targetUrl, proxyBase, req.headers);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (customHeaders) {
      for (const [key, val] of Object.entries(customHeaders)) {
        res.setHeader(key, val);
      }
    }

    if (statusCode) {
      res.status(statusCode);
    }

    if (typeof data === 'string') {
      res.send(data);
    } else {
      res.end(data);
    }
  } catch (err: any) {
    console.warn('HLS proxy notice:', err.message);
    const statusCode = err.statusCode || (err.name === 'AbortError' || err.message?.includes('Timeout') ? 504 : 502);
    // Return clean plain text error instead of JSON or HTML so HLS parser doesn't choke on syntax
    res.status(statusCode).type('text/plain').send(`HLS Proxy Error (${statusCode}): ${err.message}`);
  }
});

/**
 * Local video file upload
 */
app.post('/api/upload', upload.single('video') as any, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo de video.' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    const metadata = await probeVideoFile(filePath);
    const videoUrl = `/uploads/${path.basename(filePath)}`;

    res.json({
      success: true,
      fileName: originalName,
      filePath,
      videoUrl,
      fileSize: req.file.size,
      metadata,
    });
  } catch (err: any) {
    console.error('Error probing uploaded video:', err);
    res.json({
      success: true,
      fileName: originalName,
      filePath,
      videoUrl: `/uploads/${path.basename(filePath)}`,
      fileSize: req.file.size,
      metadata: {
        duration: 300,
        title: originalName,
      },
    });
  }
});

/**
 * AI Editorial Analysis with Google Gemini
 */
app.post('/api/ai/analyze', rateLimiter(20, 60 * 1000), async (req, res) => {
  try {
    const { duration, title, channel, focusArea, customPrompt, acousticPeaks } = req.body;

    if (!duration || duration <= 0) {
      return res.status(400).json({ error: 'La duración del video es requerida.' });
    }

    const highlights = await analyzeVodHighlights({
      duration: Number(duration),
      title: title || 'Transmisión de Kick',
      channel: channel || 'Creador',
      focusArea: focusArea || 'Reacciones y Momentos Épicos',
      customPrompt,
      acousticPeaks,
    });

    res.json({ highlights });
  } catch (err: any) {
    console.error('Error in AI analysis endpoint:', err);
    res.status(500).json({ error: err.message || 'Error al analizar el video con IA.' });
  }
});

/**
 * VOD acoustic scan with FFmpeg
 */
app.post('/api/ai/acoustic-scan', rateLimiter(15, 60 * 1000), async (req, res) => {
  try {
    const { sourceUrl, filePath, duration } = req.body;
    const target = filePath || sourceUrl;
    if (!target) {
      return res.status(400).json({ error: 'Falta la ruta o URL del video.' });
    }

    const durationSec = Number(duration) || 300;
    const acoustics = await analyzeVodAcoustics(target, durationSec);

    res.json({ acoustics });
  } catch (err: any) {
    console.error('Error scanning acoustics:', err);
    res.status(500).json({ error: err.message || 'Error al realizar el análisis acústico.' });
  }
});

/**
 * Start FFmpeg export job
 */
app.post('/api/export/start', rateLimiter(10, 60 * 1000), async (req, res) => {
  try {
    const { projectId, sourceUrl, filePath, segments, mode, totalVodDuration } = req.body;

    let source = filePath || sourceUrl;
    if (!source) {
      return res.status(400).json({ error: 'Falta la fuente del video para exportar.' });
    }

    // If source is passing through /api/kick/proxy, extract underlying stream URL for FFmpeg
    if (typeof source === 'string' && source.includes('/api/kick/proxy?url=')) {
      const parts = source.split('/api/kick/proxy?url=');
      if (parts[1]) {
        source = decodeURIComponent(parts[1]);
      }
    }

    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'No se enviaron segmentos para exportar.' });
    }

    const job = await startExportJob({
      projectId: projectId || 'proj-' + Date.now(),
      sourceUrlOrPath: source,
      segments,
      mode: mode || 'auto',
      totalVodDuration: Number(totalVodDuration) || 3600,
    });

    res.json({ job });
  } catch (err: any) {
    console.error('Error starting export job:', err);
    res.status(500).json({ error: err.message || 'No se pudo iniciar el trabajo de exportación.' });
  }
});

/**
 * Check export job status
 */
app.get('/api/export/:exportId/status', (req, res) => {
  const { exportId } = req.params;
  const job = getExportJob(exportId);
  if (!job) {
    return res.status(404).json({ error: 'Trabajo de exportación no encontrado.' });
  }
  res.json({ job });
});

/**
 * Cancel export job
 */
app.post('/api/export/:exportId/cancel', (req, res) => {
  const { exportId } = req.params;
  const cancelled = cancelExportJob(exportId);
  res.json({ cancelled });
});

/**
 * Download exported MP4
 */
app.get('/api/export/:exportId/download', (req, res) => {
  const { exportId } = req.params;
  const filePath = getExportFilePath(exportId);

  if (!filePath) {
    return res.status(404).send('El archivo exportado no existe o aún se está procesando.');
  }

  const fileName = path.basename(filePath);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'video/mp4');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

// Helper: Inspect video file using ffprobe
function probeVideoFile(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe error code ${code}`));
      }
      try {
        const info = JSON.parse(stdout);
        const format = info.format || {};
        const videoStream = (info.streams || []).find((s: any) => s.codec_type === 'video') || {};
        const audioStream = (info.streams || []).find((s: any) => s.codec_type === 'audio') || {};

        let fps = 30;
        if (videoStream.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split('/');
          if (parts.length === 2 && Number(parts[1]) > 0) {
            fps = Math.round(Number(parts[0]) / Number(parts[1]));
          }
        }

        resolve({
          duration: parseFloat(format.duration) || 0,
          width: videoStream.width || 1920,
          height: videoStream.height || 1080,
          fps,
          codecVideo: videoStream.codec_name || 'h264',
          codecAudio: audioStream.codec_name || 'aac',
          bitrate: parseInt(format.bit_rate, 10) || 0,
          format: format.format_name || 'mp4',
        });
      } catch (e) {
        reject(e);
      }
    });

    proc.on('error', reject);
  });
}

// ----------------------------------------------------
// VITE OR STATIC SERVING
// ----------------------------------------------------

async function start() {
  const server = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: {
          server: server,
        },
        hmr: {
          server: server,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`VELORA Server running on http://0.0.0.0:${PORT}`);
  });
}

start();
