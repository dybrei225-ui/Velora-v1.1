import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  RotateCw, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Scissors, 
  FastForward,
  Eye,
  AlertCircle
} from 'lucide-react';
import { Segment } from '../../types.js';

interface VideoPlayerProps {
  sourceUrl: string;
  isHls: boolean;
  segments: Segment[];
  currentTime: number;
  fps?: number;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onSplit: (time: number) => void;
  isPreviewResultActive: boolean;
  onTogglePreviewResult: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  sourceUrl,
  isHls,
  segments,
  currentTime,
  fps = 30,
  onTimeUpdate,
  onDurationChange,
  onSplit,
  isPreviewResultActive,
  onTogglePreviewResult,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [videoDuration, setVideoDuration] = useState(0);
  const [hlsError, setHlsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Initialize HLS or direct video source
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceUrl) return;

    setHlsError(null);

    // Destroy existing HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHlsStream = isHls || sourceUrl.includes('.m3u8');

    let networkRetryCount = 0;
    let mediaRetryCount = 0;
    const MAX_NETWORK_RETRIES = 3;
    const MAX_MEDIA_RETRIES = 2;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    if (isHlsStream && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        // Reasonable timeouts between 20 and 30 seconds to prevent premature aborts
        manifestLoadingTimeOut: 25000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 25000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1000,
        // Do NOT enable withCredentials blindly: cross-origin servers using Access-Control-Allow-Origin: *
        // will cause browser CORS rejection if withCredentials is true.
        xhrSetup: (xhr: XMLHttpRequest, _url: string) => {
          xhr.withCredentials = false;
        },
      });

      console.log('[HLS] URL de carga:', sourceUrl);

      hls.loadSource(sourceUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_LOADING, (_event, data) => {
        console.log('[HLS] MANIFEST_LOADING:', data.url || sourceUrl);
      });

      hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => {
        console.log('[HLS] MANIFEST_LOADED:', {
          url: data.url,
          levels: data.levels?.length,
        });
        setHlsError(null);
        networkRetryCount = 0;
        mediaRetryCount = 0;
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setHlsError(null);
        networkRetryCount = 0;
        mediaRetryCount = 0;
      });

      hls.on(Hls.Events.LEVEL_LOADING, (_event, data) => {
        console.log('[HLS] LEVEL_LOADING:', {
          level: data.level,
          url: data.url,
        });
      });

      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        console.log('[HLS] LEVEL_LOADED:', {
          level: data.level,
          targetduration: data.details?.targetduration,
          fragments: data.details?.fragments?.length,
        });
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        networkRetryCount = 0;
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[HLS] ERROR:', {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          url: data.url || (data.context && (data.context as any).url),
          response: data.response ? {
            code: data.response.code,
            text: data.response.text?.slice(0, 150),
            url: data.response.url,
          } : undefined,
        });

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (networkRetryCount < MAX_NETWORK_RETRIES) {
                networkRetryCount++;
                console.warn(`[HLS] Network error retry ${networkRetryCount}/${MAX_NETWORK_RETRIES}... (${data.details})`);
                if (retryTimeout) clearTimeout(retryTimeout);
                retryTimeout = setTimeout(() => {
                  if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
                      data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
                      data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR) {
                    hls.loadSource(sourceUrl);
                  } else {
                    hls.startLoad();
                  }
                }, 1000 * networkRetryCount);
              } else {
                console.warn('[HLS] Reached network retry limit.');
                setHlsError('No se pudo conectar con el servidor de la transmisión HLS. Verifica el enlace o intenta con otro stream.');
                hls.destroy();
                hlsRef.current = null;
              }
              break;

            case Hls.ErrorTypes.MEDIA_ERROR:
              if (mediaRetryCount < MAX_MEDIA_RETRIES) {
                mediaRetryCount++;
                console.warn(`[HLS] Media error recovery attempt (${mediaRetryCount}/${MAX_MEDIA_RETRIES})...`);
                hls.recoverMediaError();
              } else {
                console.warn('[HLS] Unrecoverable media error.');
                setHlsError('Error al decodificar el formato multimedia del stream.');
                hls.destroy();
                hlsRef.current = null;
              }
              break;

            default:
              console.warn('[HLS] Fatal error:', data.details);
              setHlsError('No se pudo reproducir el stream HLS.');
              hls.destroy();
              hlsRef.current = null;
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else {
      // Direct MP4 / WebM / Local blob
      video.src = sourceUrl;
    }

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [sourceUrl, isHls, reloadKey]);

  // Sync external seek (from timeline click)
  useEffect(() => {
    const video = videoRef.current;
    if (video && Math.abs(video.currentTime - currentTime) > 0.35) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  // Handle Play/Pause
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  // Frame or Second Step
  const step = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 10000, video.currentTime + seconds));
  }, []);

  // Keyboard Shortcuts: Space, J, K, L, Arrows, C for split
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'KeyK':
          e.preventDefault();
          togglePlay();
          break;
        case 'KeyJ':
          e.preventDefault();
          step(-5);
          break;
        case 'KeyL':
          e.preventDefault();
          step(5);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          step(e.shiftKey ? -1 : -(1 / fps));
          break;
        case 'ArrowRight':
          e.preventDefault();
          step(e.shiftKey ? 1 : (1 / fps));
          break;
        case 'KeyC':
          e.preventDefault();
          if (videoRef.current) {
            onSplit(videoRef.current.currentTime);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, step, onSplit]);

  // Timeupdate handler with Preview Result skip logic
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const current = video.currentTime;
    onTimeUpdate(current);

    // If PREVIEW RESULT mode is active: automatically skip excluded segments!
    if (isPreviewResultActive && segments.length > 0 && isPlaying) {
      const activeSegment = segments.find(s => current >= s.start && current < s.end);

      if (activeSegment && activeSegment.state === 'excluded') {
        // Find next kept segment ahead of current time
        const nextKept = segments
          .filter(s => s.state === 'kept' && s.start >= activeSegment.end - 0.05)
          .sort((a, b) => a.start - b.start)[0];

        if (nextKept) {
          video.currentTime = nextKept.start;
        } else {
          // No more kept segments, pause playback
          video.pause();
          setIsPlaying(false);
        }
      }
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video && video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
      setVideoDuration(video.duration);
      onDurationChange(video.duration);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (newVol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  const cyclePlaybackRate = () => {
    const video = videoRef.current;
    if (!video) return;
    const rates = [1, 1.25, 1.5, 2, 0.5];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    video.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  const formatTimecode = (secs: number) => {
    const safeSecs = Math.max(0, secs);
    const h = Math.floor(safeSecs / 3600);
    const m = Math.floor((safeSecs % 3600) / 60);
    const s = Math.floor(safeSecs % 60);
    const f = Math.floor((safeSecs % 1) * fps);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative flex flex-col items-center justify-center bg-[#070709] w-full h-full select-none overflow-hidden group">
      {/* Video Container */}
      <div 
        className="relative w-full h-full flex items-center justify-center cursor-pointer"
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          className="max-h-full max-w-full object-contain"
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
        />

        {/* HLS Error Overlay */}
        {hlsError && (
          <div 
            className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-6 text-center z-20 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
            <div className="text-white font-semibold text-base mb-1">Aviso de Reproducción</div>
            <div className="text-gray-300 text-xs max-w-md mb-4 leading-relaxed">{hlsError}</div>
            <button
              onClick={() => {
                setHlsError(null);
                setReloadKey((prev) => prev + 1);
              }}
              className="px-4 py-2 bg-[#53FC18] hover:bg-[#42d911] text-black font-bold text-xs rounded-lg transition-colors shadow-lg active:scale-95"
            >
              Reintentar Conexión
            </button>
          </div>
        )}

        {/* Current Segment State Badge Overlay */}
        {(() => {
          const currentSeg = segments.find(s => currentTime >= s.start && currentTime <= s.end);
          if (!currentSeg) return null;
          return (
            <div className="absolute top-4 left-4 flex items-center space-x-2 pointer-events-none z-10">
              <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider uppercase backdrop-blur-md border ${
                currentSeg.state === 'kept'
                  ? 'bg-[#53FC18]/20 border-[#53FC18]/50 text-[#53FC18]'
                  : 'bg-red-500/20 border-red-500/50 text-red-400'
              }`}>
                {currentSeg.state === 'kept' ? '✓ Conservado' : '✗ Excluido'}
              </span>
              {currentSeg.label && (
                <span className="px-2.5 py-1 rounded-md text-xs bg-black/60 backdrop-blur-md text-gray-200 border border-white/10 max-w-xs truncate">
                  {currentSeg.label}
                </span>
              )}
            </div>
          );
        })()}

        {/* Active Preview Mode Indicator */}
        {isPreviewResultActive && (
          <div className="absolute top-4 right-4 bg-[#53FC18]/20 border border-[#53FC18] text-[#53FC18] px-3 py-1 rounded-md text-xs font-bold flex items-center space-x-1.5 backdrop-blur-md z-10 shadow-[0_0_12px_rgba(83,252,24,0.3)]">
            <Eye className="w-3.5 h-3.5 animate-pulse" />
            <span>Previsualización Resultado (Salto de cortes)</span>
          </div>
        )}
      </div>

      {/* Modern Player Bar */}
      <div 
        className="w-full bg-[#0d0e14]/95 border-t border-[#1d202d] px-4 py-2.5 flex items-center justify-between text-xs text-gray-300 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Playback Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={togglePlay}
            className="w-8 h-8 rounded-lg bg-[#53FC18] hover:bg-[#45e012] text-black flex items-center justify-center transition-all shadow-[0_0_10px_rgba(83,252,24,0.3)] active:scale-95"
            title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-black stroke-none" />
            ) : (
              <Play className="w-4 h-4 fill-black stroke-none ml-0.5" />
            )}
          </button>

          <button
            onClick={() => step(-5)}
            className="p-1.5 hover:bg-[#1a1d29] rounded text-gray-300 hover:text-white transition-colors"
            title="Retroceder 5 segundos (J)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={() => step(5)}
            className="p-1.5 hover:bg-[#1a1d29] rounded text-gray-300 hover:text-white transition-colors"
            title="Avanzar 5 segundos (L)"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSplit(currentTime)}
            className="flex items-center space-x-1 bg-[#191c27] hover:bg-[#232737] text-gray-200 px-2.5 py-1.5 rounded border border-[#2b3042] transition-colors ml-2"
            title="Dividir en este segundo exacto (C)"
          >
            <Scissors className="w-3.5 h-3.5 text-[#53FC18]" />
            <span className="font-semibold text-[11px]">Corte (C)</span>
          </button>
        </div>

        {/* Center: Millimetric Timecode (Hours, Minutes, Seconds, Frames) */}
        <div className="font-mono text-xs sm:text-sm tracking-wider flex items-center space-x-2 bg-[#090a0f] px-3 py-1 rounded-md border border-[#1b1f2d]">
          <span className="text-[10px] text-gray-400 font-sans font-bold uppercase tracking-wider">TC</span>
          <span className="text-[#53FC18] font-bold">{formatTimecode(currentTime)}</span>
          <span className="text-gray-600">/</span>
          <span className="text-gray-400">{formatTimecode(videoDuration || 0)}</span>
          <span className="text-[10px] text-gray-500 font-sans font-medium">({fps} fps)</span>
        </div>

        {/* Right: Volume, Speed, Preview Toggle, Fullscreen */}
        <div className="flex items-center space-x-3">
          {/* Result preview toggle button */}
          <button
            onClick={onTogglePreviewResult}
            title="Activar previsualización del corte final"
            className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs transition-colors border ${
              isPreviewResultActive
                ? 'bg-[#53FC18]/15 border-[#53FC18] text-[#53FC18]'
                : 'bg-[#151722] border-[#25293a] text-gray-400 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Previsualizar</span>
          </button>

          {/* Speed */}
          <button
            onClick={cyclePlaybackRate}
            className="font-mono text-[11px] font-bold px-2 py-1 bg-[#161823] border border-[#25293b] rounded hover:bg-[#202333] transition-colors text-gray-300 hover:text-[#53FC18]"
            title="Velocidad de reproducción"
          >
            {playbackRate}x
          </button>

          {/* Volume Slider */}
          <div className="flex items-center space-x-1.5 group/vol">
            <button
              onClick={toggleMute}
              className="p-1 hover:text-white text-gray-400"
              title={isMuted ? 'Desmutear' : 'Mutear'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-16 h-1 bg-[#202434] accent-[#53FC18] rounded cursor-pointer"
            />
          </div>

          {/* Fullscreen */}
          <button
            onClick={() => {
              if (videoRef.current) {
                if (document.fullscreenElement) {
                  document.exitFullscreen();
                } else {
                  videoRef.current.requestFullscreen().catch(() => {});
                }
              }
            }}
            className="p-1.5 hover:bg-[#1a1d29] rounded text-gray-400 hover:text-white transition-colors"
            title="Pantalla Completa"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
