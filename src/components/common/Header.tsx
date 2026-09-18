import React from 'react';
import { 
  Scissors, 
  Sparkles, 
  Download, 
  Undo2, 
  Redo2, 
  Play, 
  Square, 
  Eye, 
  ArrowLeft,
  Clock,
  Film
} from 'lucide-react';
import { Project } from '../../types.js';

interface HeaderProps {
  project: Project | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCloseProject: () => void;
  onOpenAiPanel: () => void;
  isAiPanelOpen: boolean;
  onOpenExportModal: () => void;
  isPreviewResultActive: boolean;
  onTogglePreviewResult: () => void;
  onSplitAtPlayhead: () => void;
  totalDuration: number;
  keptDuration: number;
}

export const Header: React.FC<HeaderProps> = ({
  project,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCloseProject,
  onOpenAiPanel,
  isAiPanelOpen,
  onOpenExportModal,
  isPreviewResultActive,
  onTogglePreviewResult,
  onSplitAtPlayhead,
  totalDuration,
  keptDuration,
}) => {
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <header className="h-16 bg-[#0c0d12] border-b border-[#1c1f2b] px-4 flex items-center justify-between z-30 select-none">
      {/* Brand & Project Info */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-lg bg-[#53FC18] flex items-center justify-center shadow-[0_0_15px_rgba(83,252,24,0.4)]">
            <Film className="w-5 h-5 text-black stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-black text-lg tracking-wider text-white">VELORA</span>
              <span className="text-[10px] font-bold uppercase tracking-widest bg-[#181a24] text-[#53FC18] px-1.5 py-0.5 rounded border border-[#53FC18]/30">
                v1.0.0-prod
              </span>
            </div>
          </div>
        </div>

        {project && (
          <>
            <div className="h-6 w-px bg-[#222636]" />
            <button
              onClick={onCloseProject}
              title="Cambiar video o volver al inicio"
              className="p-1.5 text-gray-400 hover:text-white hover:bg-[#1c202d] rounded-md transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="max-w-[220px] lg:max-w-xs truncate">
              <div className="text-sm font-semibold text-gray-200 truncate" title={project.name}>
                {project.name}
              </div>
              <div className="text-xs text-gray-400 flex items-center space-x-1">
                <span className="text-[#53FC18] font-medium">{project.metadata.channel || 'Kick'}</span>
                <span>•</span>
                <span>{project.isHls ? 'HLS Stream' : 'Video Local'}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Editor Center Controls */}
      {project && (
        <div className="hidden md:flex items-center space-x-3">
          {/* Duration summary badge */}
          <div className="flex items-center space-x-2 bg-[#14161f] border border-[#232736] px-3 py-1.5 rounded-lg text-xs">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <div className="flex items-center space-x-1.5">
              <span className="text-gray-400">Total:</span>
              <span className="font-mono text-gray-300">{formatTime(totalDuration)}</span>
              <span className="text-gray-600">→</span>
              <span className="text-gray-400">Corte:</span>
              <span className="font-mono text-[#53FC18] font-bold">{formatTime(keptDuration)}</span>
            </div>
          </div>

          {/* Quick Split Button */}
          <button
            onClick={onSplitAtPlayhead}
            title="Dividir clip en el cabezal actual (Atajo: C)"
            className="flex items-center space-x-1.5 bg-[#171a24] hover:bg-[#202534] text-gray-200 hover:text-white px-3 py-1.5 rounded-lg border border-[#262b3a] transition-colors text-xs font-medium"
          >
            <Scissors className="w-3.5 h-3.5 text-[#53FC18]" />
            <span>Dividir (C)</span>
          </button>

          {/* Preview Result mode toggle */}
          <button
            onClick={onTogglePreviewResult}
            title="Previsualizar resultado final saltando partes excluidas"
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border transition-all text-xs font-semibold ${
              isPreviewResultActive
                ? 'bg-[#53FC18]/15 border-[#53FC18] text-[#53FC18] shadow-[0_0_12px_rgba(83,252,24,0.2)]'
                : 'bg-[#171a24] border-[#262b3a] text-gray-300 hover:bg-[#202534]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isPreviewResultActive ? 'Modo Corte Activo' : 'Previsualizar Corte'}</span>
          </button>

          {/* History Undo / Redo */}
          <div className="flex items-center bg-[#14161f] border border-[#232736] rounded-lg p-0.5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Deshacer (Ctrl+Z)"
              className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-[#222738] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              title="Rehacer (Ctrl+Y)"
              className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-[#222738] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Right Actions */}
      {project ? (
        <div className="flex items-center space-x-3">
          {/* AI Mode trigger */}
          <button
            onClick={onOpenAiPanel}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg border transition-all text-xs font-semibold ${
              isAiPanelOpen
                ? 'bg-purple-500/20 border-purple-400 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                : 'bg-[#191b26] border-purple-500/30 text-purple-300 hover:bg-purple-500/15 hover:border-purple-400'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Asistente IA (Gemini)</span>
          </button>

          {/* Export MP4 button */}
          <button
            onClick={onOpenExportModal}
            className="flex items-center space-x-2 bg-[#53FC18] hover:bg-[#43d910] text-black font-bold px-4 py-2 rounded-lg transition-all shadow-[0_0_15px_rgba(83,252,24,0.35)] active:scale-95 text-xs tracking-wide"
          >
            <Download className="w-4 h-4 stroke-[2.5]" />
            <span>Exportar MP4</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center space-x-3 text-xs text-gray-400">
          <span>Kick VOD & Stream Highlights Editor</span>
        </div>
      )}
    </header>
  );
};
