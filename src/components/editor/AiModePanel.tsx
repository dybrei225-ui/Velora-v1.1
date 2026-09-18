import React, { useState } from 'react';
import { 
  Sparkles, 
  X, 
  Play, 
  Check, 
  Flame, 
  Trophy, 
  Skull, 
  Smile, 
  MessageSquare, 
  Layers, 
  Volume2, 
  Loader2,
  AlertCircle
} from 'lucide-react';
import { AIHighlight, HighlightCategory, Project } from '../../types.js';

interface AiModePanelProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onApplyHighlights: (highlights: AIHighlight[]) => void;
  onPreviewTimestamp: (time: number) => void;
}

const FOCUS_AREAS = [
  { id: 'reacciones', label: 'Reacciones y Momentos Épicos', icon: Flame },
  { id: 'victorias', label: 'Jugadas / Victorias', icon: Trophy },
  { id: 'derrotas', label: 'Fails y Derrotas', icon: Skull },
  { id: 'humor', label: 'Humor y Chat', icon: Smile },
  { id: 'conversacion', label: 'Conversaciones y Charlas', icon: MessageSquare },
  { id: 'resumen', label: 'Resumen General Balanceado', icon: Layers },
];

export const AiModePanel: React.FC<AiModePanelProps> = ({
  project,
  isOpen,
  onClose,
  onApplyHighlights,
  onPreviewTimestamp,
}) => {
  const [selectedFocus, setSelectedFocus] = useState('Reacciones y Momentos Épicos');
  const [customPrompt, setCustomPrompt] = useState('');
  const [useAcousticScan, setUseAcousticScan] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [highlights, setHighlights] = useState<AIHighlight[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRunAnalysis = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setLoadingStage('Analizando señales acústicas con FFmpeg...');

    try {
      let acousticPeaks = undefined;

      if (useAcousticScan) {
        try {
          const acousticRes = await fetch('/api/ai/acoustic-scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceUrl: project.sourceUrl,
              filePath: project.localFilePath,
              duration: project.metadata.duration,
            }),
          });
          if (acousticRes.ok) {
            const data = await acousticRes.json();
            acousticPeaks = data.acoustics?.peaks;
          }
        } catch {
          // Acoustic scan is optional enhancement
        }
      }

      setLoadingStage('Consultando Google Gemini (gemini-3.1-flash-lite)...');

      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration: project.metadata.duration,
          title: project.metadata.title || project.name,
          channel: project.metadata.channel || 'Kick Streamer',
          focusArea: selectedFocus,
          customPrompt: customPrompt.trim() || undefined,
          acousticPeaks,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error del servidor: ${response.status}`);
      }

      const data = await response.json();
      const list: AIHighlight[] = data.highlights || [];

      setHighlights(list);
      setSelectedIds(new Set(list.map(h => h.id)));

      if (list.length === 0) {
        setErrorMessage('La IA no encontró clips específicos con este filtro. Intenta con otro enfoque.');
      }
    } catch (err: any) {
      console.error('Error analyzing VOD with AI:', err);
      setErrorMessage(err.message || 'No se pudo conectar con el servicio de IA.');
    } finally {
      setIsLoading(false);
      setLoadingStage('');
    }
  };

  const toggleSelectHighlight = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(highlights.map(h => h.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleApplyToTimeline = () => {
    const chosen = highlights.filter(h => selectedIds.has(h.id));
    if (chosen.length === 0) return;
    onApplyHighlights(chosen);
    onClose();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getCategoryBadge = (cat: HighlightCategory) => {
    switch (cat) {
      case 'victoria':
        return <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Victoria</span>;
      case 'derrota':
        return <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Fails/Derrota</span>;
      case 'humor':
        return <span className="bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Humor</span>;
      case 'reaccion':
        return <span className="bg-[#53FC18]/20 text-[#53FC18] border border-[#53FC18]/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Reacción</span>;
      case 'tension':
        return <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Tensión</span>;
      case 'conversacion':
        return <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Charla</span>;
      default:
        return <span className="bg-gray-700/50 text-gray-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Destacado</span>;
    }
  };

  return (
    <aside className="w-80 md:w-96 bg-[#0e1017] border-l border-[#1d212e] flex flex-col h-full select-none z-20 shadow-2xl">
      {/* Panel Header */}
      <div className="p-4 border-b border-[#1c202d] flex items-center justify-between bg-[#12141d]">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-400/40 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white">Asistente Editorial IA</h3>
            <p className="text-[11px] text-gray-400">Google Gemini & Análisis Acústico</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#1f2332] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Focus Area Selector */}
        <div>
          <label className="text-xs font-semibold text-gray-300 mb-2 block">
            Área de Enfoque Editorial
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {FOCUS_AREAS.map(item => {
              const Icon = item.icon;
              const isSelected = selectedFocus === item.label;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedFocus(item.label)}
                  className={`p-2 rounded-lg border text-left flex items-center space-x-2 transition-all ${
                    isSelected
                      ? 'bg-purple-500/15 border-purple-400 text-white shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                      : 'bg-[#151722] border-[#222738] text-gray-400 hover:text-gray-200 hover:bg-[#1a1d2b]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-purple-400' : 'text-gray-400'}`} />
                  <span className="text-[11px] font-medium leading-tight line-clamp-2">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Prompt */}
        <div>
          <label className="text-xs font-semibold text-gray-300 mb-1.5 block">
            Petición Editorial Personalizada (Opcional)
          </label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="ej: Encuentra cuando gritó tras ganar la partida o cuando contó la anécdota del viaje..."
            rows={2}
            className="w-full bg-[#13151f] border border-[#232737] rounded-lg p-2.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-400 transition-colors resize-none"
          />
        </div>

        {/* Combined Acoustic Toggle */}
        <div className="flex items-center justify-between bg-[#141620] border border-[#212636] p-2.5 rounded-lg">
          <div className="flex items-center space-x-2">
            <Volume2 className="w-4 h-4 text-[#53FC18]" />
            <div>
              <div className="text-xs font-semibold text-gray-200">Escanear Audio con FFmpeg</div>
              <div className="text-[10px] text-gray-400">Detecta picos de volumen y silencios</div>
            </div>
          </div>
          <input
            type="checkbox"
            checked={useAcousticScan}
            onChange={(e) => setUseAcousticScan(e.target.checked)}
            className="accent-[#53FC18] w-4 h-4 rounded cursor-pointer"
          />
        </div>

        {/* Analyze Button */}
        <button
          onClick={handleRunAnalysis}
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center space-x-2 shadow-[0_0_15px_rgba(147,51,234,0.35)] transition-all disabled:opacity-50 text-xs active:scale-[0.99]"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-purple-200" />
              <span>{loadingStage || 'Analizando...'}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-purple-200" />
              <span>Analizar VOD con Gemini</span>
            </>
          )}
        </button>

        {/* Error Alert */}
        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Proposed Highlights List */}
        {highlights.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-gray-300">
                Momentos Sugeridos ({selectedIds.size}/{highlights.length})
              </span>
              <div className="space-x-2 text-[11px]">
                <button onClick={selectAll} className="text-purple-400 hover:underline">Todos</button>
                <span>•</span>
                <button onClick={deselectAll} className="text-gray-400 hover:underline">Ninguno</button>
              </div>
            </div>

            <div className="space-y-2.5">
              {highlights.map((item) => {
                const isChecked = selectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg border transition-all ${
                      isChecked
                        ? 'bg-[#151722] border-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.1)]'
                        : 'bg-[#10121a] border-[#202332] opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectHighlight(item.id)}
                          className="accent-purple-500 w-3.5 h-3.5 rounded cursor-pointer mt-0.5"
                        />
                        <span className="font-semibold text-xs text-gray-200 leading-tight">
                          {item.title}
                        </span>
                      </div>
                      {getCategoryBadge(item.category)}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-400 my-1.5 pl-5">
                      <span className="font-mono text-purple-300">
                        {formatTime(item.start)} - {formatTime(item.end)}
                      </span>
                      <button
                        onClick={() => onPreviewTimestamp(item.start)}
                        className="flex items-center space-x-1 text-[#53FC18] hover:underline"
                        title="Ir a este segundo en el reproductor"
                      >
                        <Play className="w-3 h-3 fill-[#53FC18]" />
                        <span>Previsualizar</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-gray-400 pl-5 leading-relaxed bg-[#0b0c11] p-2 rounded border border-[#1b1e2a] mt-1">
                      <span className="text-gray-300 font-medium">Justificación: </span>
                      {item.reason}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer / Apply Action */}
      {highlights.length > 0 && (
        <div className="p-4 border-t border-[#1c202d] bg-[#12141d]">
          <button
            onClick={handleApplyToTimeline}
            disabled={selectedIds.size === 0}
            className="w-full bg-[#53FC18] hover:bg-[#43db10] text-black font-bold py-2.5 px-4 rounded-lg flex items-center justify-center space-x-2 transition-all shadow-[0_0_15px_rgba(83,252,24,0.35)] disabled:opacity-40 text-xs tracking-wide active:scale-[0.99]"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>Aplicar ({selectedIds.size}) a la Línea de Tiempo</span>
          </button>
          <p className="text-[10px] text-gray-400 text-center mt-2">
            Dividirá automáticamente la línea de tiempo conservando solo los clips elegidos.
          </p>
        </div>
      )}
    </aside>
  );
};
