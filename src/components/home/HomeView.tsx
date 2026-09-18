import React, { useState } from 'react';
import { 
  Film, 
  Upload, 
  Link as LinkIcon, 
  PlayCircle, 
  Sparkles, 
  Zap, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  FileVideo
} from 'lucide-react';
import { Project } from '../../types.js';

interface HomeViewProps {
  onProjectLoaded: (project: Project) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onProjectLoaded }) => {
  const [kickUrl, setKickUrl] = useState('');
  const [isResolvingKick, setIsResolvingKick] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 1. Resolve Kick Stream / VOD URL
  const handleResolveKickUrl = async (urlToResolve?: string) => {
    const targetUrl = (urlToResolve || kickUrl).trim();
    if (!targetUrl) {
      setErrorMessage('Por favor, ingresa un enlace de transmisión o VOD de Kick.');
      return;
    }

    setIsResolvingKick(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/kick/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'No se pudo resolver el VOD de Kick.');
      }

      const data = await response.json();

      // If stream is HLS and might need CORS proxy
      const streamUrl = data.streamUrl.includes('.m3u8')
        ? `/api/kick/proxy?url=${encodeURIComponent(data.streamUrl)}`
        : data.streamUrl;

      const project: Project = {
        id: `proj-${Date.now()}`,
        name: data.title || 'Transmisión de Kick',
        sourceType: 'kick',
        sourceUrl: streamUrl,
        originalUrl: targetUrl,
        isHls: data.isHls,
        metadata: {
          duration: data.duration || 3600,
          title: data.title,
          channel: data.channel,
          thumbnailUrl: data.thumbnailUrl,
        },
        segments: [
          {
            id: `seg-init-${Date.now()}`,
            start: 0,
            end: data.duration || 3600,
            state: 'kept',
            label: 'VOD Completo',
          },
        ],
        createdAt: Date.now(),
      };

      onProjectLoaded(project);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al conectar con el stream.');
    } finally {
      setIsResolvingKick(false);
    }
  };

  // 2. Load Local Video File
  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setErrorMessage(null);
    setUploadProgress(10);

    const formData = new FormData();
    formData.append('video', file);

    try {
      // Create local object URL for instant client-side playback without waiting for full 50GB transfer
      const objectUrl = URL.createObjectURL(file);

      // Probe duration from browser video element in parallel
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = objectUrl;

      const clientDuration = await new Promise<number>((resolve) => {
        tempVideo.onloadedmetadata = () => resolve(tempVideo.duration || 300);
        tempVideo.onerror = () => resolve(300);
        setTimeout(() => resolve(300), 2500);
      });

      // Upload in background to server so FFmpeg can render
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const res = JSON.parse(xhr.responseText);
          const project: Project = {
            id: `proj-local-${Date.now()}`,
            name: file.name.replace(/\.[^/.]+$/, ''),
            sourceType: 'local',
            sourceUrl: res.videoUrl || objectUrl,
            localFilePath: res.filePath,
            isHls: false,
            metadata: {
              duration: res.metadata?.duration || clientDuration,
              width: res.metadata?.width,
              height: res.metadata?.height,
              fps: res.metadata?.fps,
              title: file.name,
              codecVideo: res.metadata?.codecVideo,
              codecAudio: res.metadata?.codecAudio,
            },
            segments: [
              {
                id: `seg-init-${Date.now()}`,
                start: 0,
                end: res.metadata?.duration || clientDuration,
                state: 'kept',
                label: 'Archivo Local',
              },
            ],
            createdAt: Date.now(),
          };
          onProjectLoaded(project);
        } else {
          setErrorMessage('Error al subir el archivo al servidor.');
          setIsUploading(false);
        }
      };

      xhr.onerror = () => {
        // Even if server upload fails (e.g. offline sandbox), allow client-side editing with ObjectURL!
        const project: Project = {
          id: `proj-client-${Date.now()}`,
          name: file.name.replace(/\.[^/.]+$/, ''),
          sourceType: 'local',
          sourceUrl: objectUrl,
          isHls: false,
          metadata: {
            duration: clientDuration,
            title: file.name,
          },
          segments: [
            {
              id: `seg-init-${Date.now()}`,
              start: 0,
              end: clientDuration,
              state: 'kept',
              label: 'Archivo Local',
            },
          ],
          createdAt: Date.now(),
        };
        onProjectLoaded(project);
      };

      xhr.send(formData);

    } catch (err: any) {
      setErrorMessage(err.message || 'Error al procesar el archivo local.');
      setIsUploading(false);
    }
  };

  // 3. Load Demo VOD (Big Buck Bunny high-compatibility MP4 from Google Storage)
  const handleLoadDemoVod = () => {
    setIsResolvingKick(true);
    setErrorMessage(null);

    setTimeout(() => {
      const demoDuration = 596; // ~10 minutes
      const project: Project = {
        id: `proj-demo-${Date.now()}`,
        name: 'Kick Stream VOD (Demostración Oficial)',
        sourceType: 'demo',
        sourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        originalUrl: 'https://kick.com/video/demo-broadcast-sample',
        isHls: false,
        metadata: {
          duration: demoDuration,
          width: 1920,
          height: 1080,
          fps: 60,
          title: 'Transmisión Especial de Prueba - 1080p 60fps',
          channel: 'KickPartner_Demo',
          thumbnailUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
        },
        segments: [
          {
            id: `seg-demo-1`,
            start: 0,
            end: demoDuration,
            state: 'kept',
            label: 'Transmisión Completa',
          },
        ],
        createdAt: Date.now(),
      };

      setIsResolvingKick(false);
      onProjectLoaded(project);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#070709] text-gray-200 flex flex-col justify-between select-none">
      {/* Top Navbar */}
      <header className="h-16 border-b border-[#1b1e2c] px-6 flex items-center justify-between bg-[#0b0c12]">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-[#53FC18] flex items-center justify-center shadow-[0_0_15px_rgba(83,252,24,0.4)]">
            <Film className="w-4 h-4 text-black stroke-[2.5]" />
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-black text-xl tracking-wider text-white">VELORA</span>
            <span className="text-[10px] font-bold uppercase tracking-widest bg-[#181a24] text-[#53FC18] px-2 py-0.5 rounded border border-[#53FC18]/30">
              v1.0.0-prod
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-xs text-gray-400">
          <span className="flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-[#53FC18]" />
            <span>Proxy Anti-CORS</span>
          </span>
          <span className="flex items-center space-x-1.5">
            <Zap className="w-4 h-4 text-[#53FC18]" />
            <span>Motor FFmpeg Nativo</span>
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10 flex flex-col items-center justify-center">
        {/* Hero Section */}
        <div className="text-center max-w-2xl mb-10">
          <div className="inline-flex items-center space-x-2 bg-[#141724] border border-[#242a3e] px-3 py-1.5 rounded-full text-xs text-gray-300 mb-4 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Edición no lineal de VODs y directos asistida por Gemini AI</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-tight mb-3">
            Edita transmisiones de <span className="text-[#53FC18] drop-shadow-[0_0_20px_rgba(83,252,24,0.4)]">Kick</span> en minutos sin descargar gigabytes crudos
          </h1>
          <p className="text-sm sm:text-base text-gray-400 leading-relaxed">
            Pega el enlace de un VOD de 8 horas, deja que la Inteligencia Artificial recorte los momentos muertos y exporta un video final condensado en MP4 optimizado para YouTube.
          </p>
        </div>

        {/* Ingestion Cards Grid */}
        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Card 1: Kick URL Ingestion */}
          <div className="bg-[#0e1017] border border-[#1f2434] rounded-xl p-6 flex flex-col justify-between hover:border-[#2f364e] transition-all shadow-xl">
            <div>
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-[#53FC18]/10 border border-[#53FC18]/30 flex items-center justify-center text-[#53FC18]">
                  <LinkIcon className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-base text-white">Enlace de Kick o Stream HLS</h2>
                  <p className="text-xs text-gray-400">Pega la URL de una transmisión o VOD público</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={kickUrl}
                    onChange={(e) => setKickUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleResolveKickUrl()}
                    placeholder="https://kick.com/video/... o .m3u8"
                    className="w-full bg-[#13151f] border border-[#232737] rounded-lg px-3.5 py-2.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-[#53FC18] transition-colors"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>Ejemplos compatibles:</span>
                  <button
                    onClick={() => setKickUrl('https://kick.com/video/51d6c050-8b1b-4171-87a3-cb200faad778')}
                    className="text-[#53FC18] hover:underline"
                  >
                    Usar URL de muestra
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={() => handleResolveKickUrl()}
              disabled={isResolvingKick || isUploading}
              className="mt-6 w-full bg-[#53FC18] hover:bg-[#43db10] text-black font-bold py-2.5 px-4 rounded-lg flex items-center justify-center space-x-2 shadow-[0_0_15px_rgba(83,252,24,0.35)] transition-all disabled:opacity-50 text-xs active:scale-[0.99]"
            >
              {isResolvingKick ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Resolviendo transmisión con HLS...</span>
                </>
              ) : (
                <>
                  <Film className="w-4 h-4 stroke-[2.5]" />
                  <span>Cargar Stream en el Editor</span>
                </>
              )}
            </button>
          </div>

          {/* Card 2: Local File Upload */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFileUpload(e.dataTransfer.files[0]);
              }
            }}
            className={`border rounded-xl p-6 flex flex-col justify-between transition-all shadow-xl relative ${
              isDragging
                ? 'bg-[#53FC18]/10 border-[#53FC18]'
                : 'bg-[#0e1017] border-[#1f2434] hover:border-[#2f364e]'
            }`}
          >
            <div>
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-base text-white">Subir Video Local</h2>
                  <p className="text-xs text-gray-400">Arrastra o selecciona archivos de hasta 50 GB</p>
                </div>
              </div>

              <div className="mt-4 border-2 border-dashed border-[#232738] hover:border-[#3b425d] rounded-lg p-5 text-center flex flex-col items-center justify-center cursor-pointer bg-[#12141e] transition-colors relative group">
                <input
                  type="file"
                  accept="video/mp4,video/x-matroska,video/quicktime,video/webm,video/mp2t,.mp4,.mkv,.mov,.webm,.ts"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <FileVideo className="w-8 h-8 text-gray-500 group-hover:text-blue-400 mb-2 transition-colors" />
                <span className="text-xs text-gray-300 font-semibold mb-0.5">
                  Haz clic para buscar o arrastra tu archivo aquí
                </span>
                <span className="text-[11px] text-gray-400">
                  Soporta MP4, MKV, MOV, WebM y TS
                </span>
              </div>
            </div>

            {isUploading ? (
              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-gray-300">
                  <span>Subiendo y preparando para FFmpeg...</span>
                  <span className="font-mono font-bold text-blue-400">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-[#1c202d] rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 text-[11px] text-gray-400 flex items-center justify-between">
                <span>Límite ampliado: 50 GB</span>
                <span>Procesamiento local con ffprobe</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Demo Button */}
        <div className="w-full bg-[#11131b] border border-[#202434] rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg">
          <div className="flex items-center space-x-3 text-center sm:text-left">
            <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <PlayCircle className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">¿Quieres probar el editor de inmediato?</div>
              <div className="text-[11px] text-gray-400">Carga un VOD demo precargado de prueba de 10 minutos para probar atajos, IA y cortes.</div>
            </div>
          </div>

          <button
            onClick={handleLoadDemoVod}
            disabled={isResolvingKick || isUploading}
            className="bg-[#191d29] hover:bg-[#232838] border border-[#2e3448] text-gray-200 hover:text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all shrink-0 active:scale-95"
          >
            <PlayCircle className="w-4 h-4 text-[#53FC18]" />
            <span>Cargar VOD de Demostración</span>
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mt-4 w-full bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Technical Capabilities Pill Bar */}
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full text-center">
          <div className="bg-[#0b0c12] border border-[#1b1e2a] p-3 rounded-lg">
            <div className="text-xs font-bold text-[#53FC18]">hls.js Integrado</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Reproduce streams Kick sin latencia</div>
          </div>
          <div className="bg-[#0b0c12] border border-[#1b1e2a] p-3 rounded-lg">
            <div className="text-xs font-bold text-purple-400">Gemini Editorial</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Detección de jugadas y momentos épicos</div>
          </div>
          <div className="bg-[#0b0c12] border border-[#1b1e2a] p-3 rounded-lg">
            <div className="text-xs font-bold text-blue-400">Previsualización</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Salto en tiempo real de cortes descartados</div>
          </div>
          <div className="bg-[#0b0c12] border border-[#1b1e2a] p-3 rounded-lg">
            <div className="text-xs font-bold text-emerald-400">Render FFmpeg</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Stream-copy, híbrido y preciso en MP4</div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-12 border-t border-[#181a26] px-6 flex items-center justify-between text-[11px] text-gray-400 bg-[#090a0f]">
        <span>VELORA v1.0.0-prod • Diseñado para creadores y editores de Kick</span>
        <span>Exportación MP4 para YouTube</span>
      </footer>
    </div>
  );
};
