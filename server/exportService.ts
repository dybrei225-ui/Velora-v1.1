import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ExportJob, ExportMode, ExportStatus, Segment } from '../src/types.js';

const EXPORTS_DIR = path.resolve(process.cwd(), 'exports_temp');
const TEMP_SEGMENTS_DIR = path.resolve(process.cwd(), 'segments_temp');

// Ensure directories exist
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_SEGMENTS_DIR)) {
  fs.mkdirSync(TEMP_SEGMENTS_DIR, { recursive: true });
}

// Cleanup old exports older than 3 hours
setInterval(() => {
  cleanOldFiles(EXPORTS_DIR, 3 * 60 * 60 * 1000);
  cleanOldFiles(TEMP_SEGMENTS_DIR, 1 * 60 * 60 * 1000);
}, 30 * 60 * 1000);

function cleanOldFiles(dir: string, maxAgeMs: number) {
  try {
    const files = fs.readdirSync(dir);
    const now = Date.now();
    for (const file of files) {
      const p = path.join(dir, file);
      const stat = fs.statSync(p);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
  } catch {}
}

const activeJobs = new Map<string, ExportJob>();
const activeProcesses = new Map<string, ChildProcess>();

export interface StartExportParams {
  projectId: string;
  sourceUrlOrPath: string;
  segments: Segment[]; // Kept segments
  mode: ExportMode;
  totalVodDuration: number;
}

export function getExportJob(jobId: string): ExportJob | undefined {
  return activeJobs.get(jobId);
}

export function cancelExportJob(jobId: string): boolean {
  const proc = activeProcesses.get(jobId);
  if (proc) {
    try {
      proc.kill('SIGKILL');
    } catch {}
    activeProcesses.delete(jobId);
  }
  const job = activeJobs.get(jobId);
  if (job && job.status === 'processing') {
    job.status = 'cancelled';
    job.stage = 'Cancelado por el usuario';
    return true;
  }
  return false;
}

export async function startExportJob(params: StartExportParams): Promise<ExportJob> {
  const jobId = 'exp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const keptSegments = params.segments
    .filter(s => s.state === 'kept' && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  if (keptSegments.length === 0) {
    throw new Error('No hay segmentos marcados como "Conservados" (kept) para exportar.');
  }

  const outputFileName = `velora_cut_${jobId}.mp4`;
  const outputFilePath = path.join(EXPORTS_DIR, outputFileName);

  const job: ExportJob = {
    id: jobId,
    projectId: params.projectId,
    status: 'queued',
    mode: params.mode,
    progress: 0,
    stage: 'Inicializando motor de renderizado FFmpeg...',
    outputFileName,
    downloadUrl: `/api/export/${jobId}/download`,
    startedAt: Date.now(),
  };

  activeJobs.set(jobId, job);

  // Run pipeline in background
  runExportPipeline(jobId, params.sourceUrlOrPath, keptSegments, params.mode, outputFilePath).catch(err => {
    console.error(`Export ${jobId} failed:`, err);
    job.status = 'failed';
    job.error = err.message || 'Error desconocido durante la exportación con FFmpeg';
    job.stage = 'Error de renderizado';
  });

  return job;
}

async function runExportPipeline(
  jobId: string,
  sourceUrlOrPath: string,
  segments: Segment[],
  requestedMode: ExportMode,
  finalOutputPath: string
) {
  const job = activeJobs.get(jobId)!;
  job.status = 'processing';
  job.stage = 'Preparando estrategia de corte...';
  job.progress = 5;

  const jobTempDir = path.join(TEMP_SEGMENTS_DIR, jobId);
  fs.mkdirSync(jobTempDir, { recursive: true });

  const totalKeptDuration = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
  const partFiles: string[] = [];

  // Determine effective mode
  let effectiveMode: 'stream-copy' | 'precise' | 'hybrid' = 'precise';
  if (requestedMode === 'stream-copy') {
    effectiveMode = 'stream-copy';
  } else if (requestedMode === 'hybrid') {
    effectiveMode = 'hybrid';
  } else if (requestedMode === 'auto') {
    // Auto: If local file and duration is large (> 10 mins), use hybrid or stream-copy; if HLS stream, use precise for frame accuracy
    effectiveMode = sourceUrlOrPath.includes('.m3u8') ? 'precise' : 'hybrid';
  }

  job.stage = `Extrayendo fragmentos en modo ${effectiveMode}...`;

  try {
    for (let i = 0; i < segments.length; i++) {
      if ((job.status as ExportStatus) === 'cancelled') break;

      const seg = segments[i];
      const partPath = path.join(jobTempDir, `part_${i}.mp4`);
      partFiles.push(partPath);

      const segDuration = seg.end - seg.start;
      const progressBase = 10 + Math.round((i / segments.length) * 70);
      job.stage = `Procesando segmento ${i + 1} de ${segments.length} (${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s)...`;
      job.progress = progressBase;

      await renderSegment({
        jobId,
        source: sourceUrlOrPath,
        start: seg.start,
        duration: segDuration,
        outputPath: partPath,
        mode: effectiveMode,
        onProgress: (subProgress) => {
          const chunkShare = 70 / segments.length;
          const current = 10 + (i * chunkShare) + (subProgress * chunkShare);
          job.progress = Math.min(85, Math.round(current));
        }
      });
    }

    if ((job.status as ExportStatus) === 'cancelled') {
      cleanupDir(jobTempDir);
      return;
    }

    // Step 2: Concatenate all parts
    job.stage = 'Ensamblando y multiplexando contenedor MP4 final...';
    job.progress = 85;

    if (partFiles.length === 1) {
      // Single segment: just copy to final destination
      fs.copyFileSync(partFiles[0], finalOutputPath);
    } else {
      // Concat list
      const concatListPath = path.join(jobTempDir, 'concat_list.txt');
      const fileEntries = partFiles.map(p => `file '${p}'`).join('\n');
      fs.writeFileSync(concatListPath, fileEntries, 'utf-8');

      await new Promise<void>((resolve, reject) => {
        const concatArgs = [
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-c', 'copy',
          '-movflags', '+faststart',
          '-y',
          finalOutputPath
        ];

        const proc = spawn('ffmpeg', concatArgs);
        activeProcesses.set(jobId, proc);

        proc.on('close', (code) => {
          activeProcesses.delete(jobId);
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg concat exited with code ${code}`));
        });

        proc.on('error', (err) => {
          activeProcesses.delete(jobId);
          reject(err);
        });
      });
    }

    // Verify output file
    if (!fs.existsSync(finalOutputPath)) {
      throw new Error('El archivo exportado no se generó correctamente.');
    }

    const stat = fs.statSync(finalOutputPath);
    job.status = 'completed';
    job.progress = 100;
    job.stage = '¡Exportación completada exitosamente!';
    job.fileSize = stat.size;
    job.duration = totalKeptDuration;
    job.completedAt = Date.now();

    // Clean up temporary segment parts
    cleanupDir(jobTempDir);

  } catch (err: any) {
    cleanupDir(jobTempDir);
    throw err;
  }
}

interface RenderSegmentParams {
  jobId: string;
  source: string;
  start: number;
  duration: number;
  outputPath: string;
  mode: 'stream-copy' | 'precise' | 'hybrid';
  onProgress?: (progress0to1: number) => void;
}

function renderSegment(params: RenderSegmentParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const { jobId, source, start, duration, outputPath, mode, onProgress } = params;

    let args: string[] = [];

    if (mode === 'stream-copy') {
      // Fast stream-copy without re-encoding
      args = [
        '-ss', String(start),
        '-i', source,
        '-t', String(duration),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-y',
        outputPath
      ];
    } else if (mode === 'hybrid') {
      // Smart hybrid: fast ultrafast encoding to ensure smooth keyframe synchronization and audio sync
      args = [
        '-ss', String(start),
        '-i', source,
        '-t', String(duration),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '22',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-avoid_negative_ts', 'make_zero',
        '-y',
        outputPath
      ];
    } else {
      // Precise frame-accurate cut
      args = [
        '-ss', String(start),
        '-i', source,
        '-t', String(duration),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];
    }

    const proc = spawn('ffmpeg', args);
    activeProcesses.set(jobId, proc);

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      const str = chunk.toString();
      stderr += str;
      const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch && onProgress && duration > 0) {
        const hours = parseInt(timeMatch[1], 10);
        const mins = parseInt(timeMatch[2], 10);
        const secs = parseFloat(timeMatch[3]);
        const currentSecs = hours * 3600 + mins * 60 + secs;
        const ratio = Math.min(1, Math.max(0, currentSecs / duration));
        onProgress(ratio);
      }
    });

    proc.on('close', (code) => {
      activeProcesses.delete(jobId);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg error (code ${code}): ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      activeProcesses.delete(jobId);
      reject(err);
    });
  });
}

function cleanupDir(dirPath: string) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {}
}

export function getExportFilePath(jobId: string): string | null {
  const job = activeJobs.get(jobId);
  if (!job || !job.outputFileName) return null;
  const filePath = path.join(EXPORTS_DIR, job.outputFileName);
  return fs.existsSync(filePath) ? filePath : null;
}
