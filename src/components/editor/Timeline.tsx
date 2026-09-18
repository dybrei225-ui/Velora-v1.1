import React, { useRef, useState, useCallback, useMemo } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Scissors, 
  Check, 
  X, 
  ArrowLeft, 
  ArrowRight, 
  Trash2,
  Clock
} from 'lucide-react';
import { Segment } from '../../types.js';

interface TimelineProps {
  segments: Segment[];
  totalDuration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  onSplit: (time: number) => void;
  onToggleState: (segmentId: string) => void;
  onTrim: (segmentId: string, newStart?: number, newEnd?: number) => void;
  onReorder: (segmentId: string, direction: 'left' | 'right') => void;
  onDelete: (segmentId: string) => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  segments,
  totalDuration,
  currentTime,
  onSeek,
  onSplit,
  onToggleState,
  onTrim,
  onReorder,
  onDelete,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState(1); // 1 = fit, 2 = 2x zoom, up to 10x
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isDraggingTrim, setIsDraggingTrim] = useState<{ segmentId: string; handle: 'start' | 'end' } | null>(null);

  const effectiveDuration = Math.max(1, totalDuration);

  // Time format helper
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Convert mouse X to timeline seconds
  const getTimeFromMouseEvent = useCallback((e: React.MouseEvent | MouseEvent): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = x / rect.width;
    return Math.max(0, Math.min(effectiveDuration, ratio * effectiveDuration));
  }, [effectiveDuration]);

  // Handle click to seek
  const handleTrackClick = (e: React.MouseEvent) => {
    if (isDraggingTrim) return;
    const time = getTimeFromMouseEvent(e);
    onSeek(time);
  };

  // Handle Scrubbing
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.trim-handle')) return;
    setIsScrubbing(true);
    const time = getTimeFromMouseEvent(e);
    onSeek(time);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const moveTime = getTimeFromMouseEvent(moveEvent);
      onSeek(moveTime);
    };

    const onMouseUp = () => {
      setIsScrubbing(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Handle Trim Drag
  const startTrim = (segmentId: string, handle: 'start' | 'end', e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingTrim({ segmentId, handle });

    const onMouseMove = (moveEvent: MouseEvent) => {
      const moveTime = getTimeFromMouseEvent(moveEvent);
      if (handle === 'start') {
        onTrim(segmentId, moveTime, undefined);
      } else {
        onTrim(segmentId, undefined, moveTime);
      }
    };

    const onMouseUp = () => {
      setIsDraggingTrim(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Generate ruler tick marks based on zoom and duration
  const rulerTicks = useMemo(() => {
    const ticks: Array<{ time: number; label: string; isMajor: boolean }> = [];
    const count = Math.max(5, Math.min(60, Math.round(20 * zoomLevel)));
    const step = effectiveDuration / count;

    for (let i = 0; i <= count; i++) {
      const time = i * step;
      const isMajor = i % 2 === 0;
      ticks.push({
        time,
        label: formatTime(time),
        isMajor,
      });
    }
    return ticks;
  }, [effectiveDuration, zoomLevel]);

  const activeSegment = segments.find(s => s.id === selectedSegmentId) || 
    segments.find(s => currentTime >= s.start && currentTime <= s.end);

  return (
    <div 
      ref={containerRef}
      className="bg-[#0b0c11] border-t border-[#1e2230] flex flex-col select-none text-xs w-full overflow-hidden"
    >
      {/* Timeline Controls Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1d29] bg-[#0e0f16]">
        <div className="flex items-center space-x-3">
          <span className="font-bold text-gray-300 flex items-center space-x-1.5">
            <Clock className="w-3.5 h-3.5 text-[#53FC18]" />
            <span>Línea de Tiempo</span>
          </span>
          <span className="text-gray-500">•</span>
          <span className="text-gray-400">
            {segments.length} {segments.length === 1 ? 'segmento' : 'segmentos'}
          </span>
        </div>

        {/* Selected Segment Quick Bar */}
        {activeSegment && (
          <div className="flex items-center space-x-2 bg-[#141620] border border-[#232737] px-3 py-1 rounded-md">
            <span className="text-gray-400 font-medium truncate max-w-[140px]">
              {activeSegment.label || `Clip (${(activeSegment.end - activeSegment.start).toFixed(1)}s)`}:
            </span>
            <button
              onClick={() => onToggleState(activeSegment.id)}
              className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center space-x-1 transition-colors ${
                activeSegment.state === 'kept'
                  ? 'bg-[#53FC18]/20 text-[#53FC18] hover:bg-[#53FC18]/30'
                  : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              }`}
            >
              {activeSegment.state === 'kept' ? (
                <>
                  <Check className="w-3 h-3" />
                  <span>Conservado</span>
                </>
              ) : (
                <>
                  <X className="w-3 h-3" />
                  <span>Excluido</span>
                </>
              )}
            </button>

            <div className="h-3 w-px bg-gray-700" />

            <button
              onClick={() => onSplit(currentTime)}
              title="Dividir en cabezal (C)"
              className="p-1 text-gray-300 hover:text-white hover:bg-[#202535] rounded"
            >
              <Scissors className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => onReorder(activeSegment.id, 'left')}
              title="Mover a la izquierda"
              className="p-1 text-gray-300 hover:text-white hover:bg-[#202535] rounded"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => onReorder(activeSegment.id, 'right')}
              title="Mover a la derecha"
              className="p-1 text-gray-300 hover:text-white hover:bg-[#202535] rounded"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => onDelete(activeSegment.id)}
              title="Eliminar o fusionar segmento"
              className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Zoom Controls */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setZoomLevel(prev => Math.max(1, prev - 0.5))}
            disabled={zoomLevel <= 1}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 rounded hover:bg-[#1c202d] transition-colors"
            title="Reducir Zoom"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="font-mono text-[11px] text-gray-400 min-w-[28px] text-center">
            {zoomLevel.toFixed(1)}x
          </span>
          <button
            onClick={() => setZoomLevel(prev => Math.min(8, prev + 0.5))}
            disabled={zoomLevel >= 8}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 rounded hover:bg-[#1c202d] transition-colors"
            title="Aumentar Zoom"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoomLevel(1)}
            className="p-1 text-gray-400 hover:text-white rounded hover:bg-[#1c202d] transition-colors"
            title="Ajustar a la pantalla"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Timeline Area */}
      <div className="w-full overflow-x-auto py-3 px-4 relative">
        <div 
          ref={trackRef}
          style={{ width: `${100 * zoomLevel}%`, minWidth: '100%' }}
          className="relative select-none cursor-pointer"
          onClick={handleTrackClick}
          onMouseDown={handleMouseDown}
          onMouseMove={(e) => setHoverTime(getTimeFromMouseEvent(e))}
          onMouseLeave={() => setHoverTime(null)}
        >
          {/* Time Ruler Ticks */}
          <div className="h-6 w-full relative border-b border-[#232737] mb-2 pointer-events-none">
            {rulerTicks.map((tick, idx) => {
              const leftPercent = (tick.time / effectiveDuration) * 100;
              return (
                <div 
                  key={idx} 
                  className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center"
                  style={{ left: `${leftPercent}%` }}
                >
                  {tick.isMajor && (
                    <span className="text-[10px] font-mono text-gray-400 mb-0.5">
                      {tick.label}
                    </span>
                  )}
                  <div className={`w-px ${tick.isMajor ? 'h-2.5 bg-gray-500' : 'h-1.5 bg-gray-700'}`} />
                </div>
              );
            })}
          </div>

          {/* Segments Track */}
          <div className="h-14 w-full bg-[#11131c] rounded-lg border border-[#222736] relative flex overflow-hidden shadow-inner">
            {segments.map((segment) => {
              const leftPercent = (segment.start / effectiveDuration) * 100;
              const widthPercent = ((segment.end - segment.start) / effectiveDuration) * 100;
              const isSelected = selectedSegmentId === segment.id;
              const isKept = segment.state === 'kept';
              const durationSec = segment.end - segment.start;

              return (
                <div
                  key={segment.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSegmentId(segment.id);
                  }}
                  className={`absolute top-0 bottom-0 transition-shadow group flex items-center justify-between overflow-hidden border-r border-[#0d0e15] cursor-pointer ${
                    isKept
                      ? isSelected
                        ? 'bg-[#53FC18]/40 border-y-2 border-[#53FC18] shadow-[0_0_12px_rgba(83,252,24,0.4)]'
                        : 'bg-[#53FC18]/25 hover:bg-[#53FC18]/30 border-y border-[#53FC18]/40'
                      : isSelected
                      ? 'bg-red-950/60 border-y-2 border-red-500'
                      : 'bg-[#1a1b24] hover:bg-[#20222f] border-y border-transparent opacity-65'
                  }`}
                  style={{
                    left: `${leftPercent}%`,
                    width: `${Math.max(0.5, widthPercent)}%`,
                  }}
                >
                  {/* Left Trim Handle */}
                  <div
                    className="trim-handle absolute left-0 top-0 bottom-0 w-2.5 hover:w-3.5 bg-white/20 hover:bg-[#53FC18] cursor-ew-resize opacity-0 group-hover:opacity-100 transition-all z-20 flex items-center justify-center"
                    onMouseDown={(e) => startTrim(segment.id, 'start', e)}
                    title="Ajustar inicio de corte"
                  >
                    <div className="w-0.5 h-4 bg-black/60 rounded" />
                  </div>

                  {/* Segment Label and Details */}
                  <div className="px-2 truncate pointer-events-none select-none w-full flex items-center justify-between text-[11px]">
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isKept ? 'bg-[#53FC18]' : 'bg-red-500'}`} />
                      <span className={`font-semibold truncate ${isKept ? 'text-white' : 'text-gray-400 line-through'}`}>
                        {segment.label || (isKept ? 'Clip' : 'Descartado')}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-gray-400 shrink-0 ml-1">
                      {durationSec.toFixed(1)}s
                    </span>
                  </div>

                  {/* Right Trim Handle */}
                  <div
                    className="trim-handle absolute right-0 top-0 bottom-0 w-2.5 hover:w-3.5 bg-white/20 hover:bg-[#53FC18] cursor-ew-resize opacity-0 group-hover:opacity-100 transition-all z-20 flex items-center justify-center"
                    onMouseDown={(e) => startTrim(segment.id, 'end', e)}
                    title="Ajustar fin de corte"
                  >
                    <div className="w-0.5 h-4 bg-black/60 rounded" />
                  </div>
                </div>
              );
            })}

            {/* Playhead Marker */}
            {(() => {
              const playheadPercent = (currentTime / effectiveDuration) * 100;
              return (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[#53FC18] z-30 pointer-events-none shadow-[0_0_10px_#53FC18]"
                  style={{ left: `${playheadPercent}%` }}
                >
                  <div className="w-3.5 h-4 bg-[#53FC18] -translate-x-[5px] -translate-y-2 rounded-sm shadow-md flex items-center justify-center">
                    <div className="w-1 h-1 bg-black rounded-full" />
                  </div>
                </div>
              );
            })()}

            {/* Hover Indicator */}
            {hoverTime !== null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-white/40 z-25 pointer-events-none"
                style={{ left: `${(hoverTime / effectiveDuration) * 100}%` }}
              >
                <div className="absolute -top-6 -translate-x-1/2 bg-black/80 text-white font-mono text-[10px] px-1.5 py-0.5 rounded border border-white/20 backdrop-blur-sm whitespace-nowrap">
                  {formatTime(hoverTime)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
