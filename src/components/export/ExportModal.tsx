import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  Target, 
  Sparkles, 
  Settings2,
  Film,
  Loader2,
  Check
} from 'lucide-react';
import { ExportJob, ExportMode, Project } from '../../types.js';

interface ExportModalProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  keptDuration: number;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  isOpen,
  onClose,
  keptDuration,
}) => {
  const [mode, setMode] = useState<ExportMode>('auto');
  const [job, setJob] = useState<ExportJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const keptSegments = project.segments
    .filter(s => s.state === 'kept' && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    }
    return `${m}m ${s}s`;
  };

  // Estimate file size: ~4 Mbps for 1080p
  const estimatedMb = Math.round((keptDuration * 4) / 8);

  const handleStartExport = async () => {
    setIsStarting(true);
    setError(null);

    try {
      const response = await fetch('/api/export/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          sourceUrl: project.sourceUrl,
          filePath: project.localFilePath,
          segments: keptSegments,
          mode,
          totalVodDuration: project.metadata.duration,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo iniciar el proceso de renderizado.');
      }

      const { job: initialJob } = await response.json();
      setJob(initialJob);

      // Start polling status
      pollJobStatus(initialJob.id);
    } catch (err: any) {
      setError(err.message || 'Error al conectar con el servidor FFmpeg.');
      setIsStarting(false);
    }
  };

  const pollJobStatus = (jobId: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/export/${jobId}/status`);
        if (!res.ok) return;

        const data = await res.json();
        const updatedJob: ExportJob = data.job;
        setJob(updatedJob);

        if (updatedJob.status === 'completed' || updatedJob.status === 'failed' || updatedJob.status === 'cancelled') {
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setIsStarting(false);
        }
      } catch {
        // Retry next poll
      }
    }, 1000);
  };

  const handleCancel = async () => {
    if (!job) return;
    try {
      await fetch(`/api/export/${job.id}/cancel`, { method: 'POST' });
      setJob(prev => prev ? { ...prev, status: 'cancelled', stage: 'Cancelado por el usuario' } : null);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    } catch {}
  };

  const MODES = [
    {
      id: 'auto' as ExportMode,
      title: 'Automático (Recomendado)',
      icon: Settings2,
      desc: 'Elige de forma inteligente entre stream-copy o renderizado según el formato del stream.',
      badge: 'Óptimo',
    },
    {
      id: 'stream-copy' as ExportMode,
      title: 'Copia Rápida (Stream-Copy)',
      icon: Zap,
      desc: 'Corta en keyframes sin recodificar. Velocidad ultrarrápida instantánea y cero pérdida de calidad.',
      badge: 'Ultrarrápido',
    },
    {
      id: 'precise' as ExportMode,
      title: 'Preciso (Frame-Accurate)',
      icon: Target,
      desc: 'Recodifica con libx264 y aac al fotograma exacto. Ideal para cortes milimétricos en jugadas.',
      badge: 'Milimétrico',
    },
    {
      id: 'hybrid' as ExportMode,
      title: 'Híbrido Inteligente',
      icon: Sparkles,
      desc: 'Combina copia rápida para el cuerpo del clip y recodificación en las uniones.',
      badge: 'Equilibrado',
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#0e1017] border border-[#232737] rounded-xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1f2332] flex items-center justify-between bg-[#13151f]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#53FC18] flex items-center justify-center text-black shadow-[0_0_12px_rgba(83,252,24,0.3)]">
              <Download className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Exportación FFmpeg MP4</h3>
              <p className="text-xs text-gray-400">Optimizado para YouTube (H.264 / AAC 1080p)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-[#1e2230] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5">
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3 bg-[#131520] p-3.5 rounded-lg border border-[#212638]">
            <div>
              <div className="text-[11px] text-gray-400">Segmentos a unir</div>
              <div className="text-sm font-bold text-white mt-0.5">{keptSegments.length} clips</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-400">Duración final</div>
              <div className="text-sm font-bold text-[#53FC18] mt-0.5">{formatDuration(keptDuration)}</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-400">Tamaño estimado</div>
              <div className="text-sm font-bold text-gray-300 mt-0.5">~{estimatedMb} MB</div>
            </div>
          </div>

          {/* Mode Selection (Only before starting or if idle) */}
          {!job || job.status === 'failed' || job.status === 'cancelled' ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-300 block">
                Selecciona la Estrategia de Exportación
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {MODES.map((item) => {
                  const Icon = item.icon;
                  const isSelected = mode === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setMode(item.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-[#53FC18]/10 border-[#53FC18] shadow-[0_0_10px_rgba(83,252,24,0.15)]'
                          : 'bg-[#141620] border-[#222736] hover:bg-[#1a1d2b] hover:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center space-x-2">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-[#53FC18]' : 'text-gray-400'}`} />
                          <span className="font-semibold text-xs text-white">{item.title}</span>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                          isSelected ? 'bg-[#53FC18]/20 text-[#53FC18]' : 'bg-[#1e2230] text-gray-400'
                        }`}>
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 leading-snug">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Progress & Rendering State */
            <div className="bg-[#12141e] border border-[#212536] p-4 rounded-lg space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  {job.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-[#53FC18]" />
                  ) : job.status === 'processing' || job.status === 'queued' ? (
                    <Loader2 className="w-4 h-4 text-[#53FC18] animate-spin" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  )}
                  <span className="font-semibold text-gray-200">{job.stage}</span>
                </div>
                <span className="font-mono text-xs font-bold text-[#53FC18]">{job.progress}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-[#1c202d] rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    job.status === 'completed' ? 'bg-[#53FC18]' : 'bg-gradient-to-r from-[#53FC18] to-emerald-400'
                  }`}
                  style={{ width: `${job.progress}%` }}
                />
              </div>

              {job.fileSize && (
                <div className="text-[11px] text-gray-400 flex items-center justify-between pt-1">
                  <span>Archivo generado:</span>
                  <span className="font-mono text-gray-300">
                    {(job.fileSize / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[#1e2230] bg-[#12141e] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-[#1c202d] transition-colors"
          >
            {job?.status === 'completed' ? 'Cerrar' : 'Cancelar'}
          </button>

          {job?.status === 'completed' ? (
            <a
              href={job.downloadUrl}
              download={job.outputFileName || 'velora_cut.mp4'}
              className="bg-[#53FC18] hover:bg-[#43d710] text-black font-bold px-5 py-2.5 rounded-lg flex items-center space-x-2 shadow-[0_0_20px_rgba(83,252,24,0.4)] transition-all text-xs active:scale-95"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>Descargar Video MP4</span>
            </a>
          ) : job?.status === 'processing' ? (
            <button
              onClick={handleCancel}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
            >
              Cancelar Renderizado
            </button>
          ) : (
            <button
              onClick={handleStartExport}
              disabled={isStarting || keptSegments.length === 0}
              className="bg-[#53FC18] hover:bg-[#43d710] text-black font-bold px-5 py-2.5 rounded-lg flex items-center space-x-2 shadow-[0_0_15px_rgba(83,252,24,0.35)] transition-all disabled:opacity-40 text-xs active:scale-95"
            >
              {isStarting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Iniciando...</span>
                </>
              ) : (
                <>
                  <Film className="w-4 h-4 stroke-[2.5]" />
                  <span>Comenzar Exportación</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
