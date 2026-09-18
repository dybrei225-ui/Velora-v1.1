import { useState, useCallback, useMemo } from 'react';
import { Project, Segment, AIHighlight } from '../types.js';

export interface UseProjectReturn {
  project: Project | null;
  loadProject: (newProject: Project) => void;
  closeProject: () => void;
  splitAt: (time: number) => void;
  toggleSegmentState: (segmentId: string) => void;
  setSegmentState: (segmentId: string, state: 'kept' | 'excluded') => void;
  trimSegment: (segmentId: string, newStart?: number, newEnd?: number) => void;
  deleteSegment: (segmentId: string) => void;
  reorderSegment: (segmentId: string, direction: 'left' | 'right') => void;
  applyAIHighlights: (highlights: AIHighlight[]) => void;
  resetToSingleSegment: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  totalDuration: number;
  keptDuration: number;
  excludedDuration: number;
  keptPercentage: number;
}

const MAX_HISTORY = 30;

export function useProject(): UseProjectReturn {
  const [project, setProject] = useState<Project | null>(() => {
    // Optionally load from sessionStorage or start fresh
    return null;
  });

  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);

  const pushState = useCallback((newProject: Project) => {
    setProject(current => {
      if (current) {
        setHistory(prev => [...prev.slice(-MAX_HISTORY), current]);
        setFuture([]);
      }
      return newProject;
    });
  }, []);

  const loadProject = useCallback((newProject: Project) => {
    setProject(newProject);
    setHistory([]);
    setFuture([]);
  }, []);

  const closeProject = useCallback(() => {
    setProject(null);
    setHistory([]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (history.length === 0 || !project) return;
    const previous = history[history.length - 1];
    setHistory(prev => prev.slice(0, prev.length - 1));
    setFuture(prev => [project, ...prev]);
    setProject(previous);
  }, [history, project]);

  const redo = useCallback(() => {
    if (future.length === 0 || !project) return;
    const next = future[0];
    setFuture(prev => prev.slice(1));
    setHistory(prev => [...prev, project]);
    setProject(next);
  }, [future, project]);

  /**
   * Split the segment containing `time` into two segments
   */
  const splitAt = useCallback((time: number) => {
    if (!project) return;
    const cleanTime = Math.round(time * 100) / 100;
    const segments = [...project.segments];

    // Find the segment containing this time
    const targetIdx = segments.findIndex(
      s => cleanTime > s.start + 0.05 && cleanTime < s.end - 0.05
    );

    if (targetIdx === -1) return;

    const target = segments[targetIdx];
    const seg1: Segment = {
      ...target,
      id: `seg-${Date.now()}-a`,
      end: cleanTime,
    };
    const seg2: Segment = {
      ...target,
      id: `seg-${Date.now()}-b`,
      start: cleanTime,
    };

    segments.splice(targetIdx, 1, seg1, seg2);

    pushState({
      ...project,
      segments,
    });
  }, [project, pushState]);

  /**
   * Toggle segment between 'kept' and 'excluded'
   */
  const toggleSegmentState = useCallback((segmentId: string) => {
    if (!project) return;
    const segments = project.segments.map(s => {
      if (s.id === segmentId) {
        return {
          ...s,
          state: s.state === 'kept' ? ('excluded' as const) : ('kept' as const),
        };
      }
      return s;
    });

    pushState({
      ...project,
      segments,
    });
  }, [project, pushState]);

  const setSegmentState = useCallback((segmentId: string, state: 'kept' | 'excluded') => {
    if (!project) return;
    const segments = project.segments.map(s => {
      if (s.id === segmentId) {
        return { ...s, state };
      }
      return s;
    });
    pushState({ ...project, segments });
  }, [project, pushState]);

  /**
   * Trim segment start or end boundary
   */
  const trimSegment = useCallback((segmentId: string, newStart?: number, newEnd?: number) => {
    if (!project) return;
    const segments = [...project.segments];
    const idx = segments.findIndex(s => s.id === segmentId);
    if (idx === -1) return;

    const current = segments[idx];
    const prevSeg = idx > 0 ? segments[idx - 1] : null;
    const nextSeg = idx < segments.length - 1 ? segments[idx + 1] : null;

    let updatedStart = current.start;
    let updatedEnd = current.end;

    if (newStart !== undefined) {
      const minStart = prevSeg ? prevSeg.start + 0.1 : 0;
      const maxStart = current.end - 0.2;
      updatedStart = Math.max(minStart, Math.min(maxStart, newStart));
      if (prevSeg) {
        prevSeg.end = updatedStart;
      }
    }

    if (newEnd !== undefined) {
      const minEnd = current.start + 0.2;
      const maxEnd = nextSeg ? nextSeg.end - 0.1 : project.metadata.duration;
      updatedEnd = Math.max(minEnd, Math.min(maxEnd, newEnd));
      if (nextSeg) {
        nextSeg.start = updatedEnd;
      }
    }

    current.start = Math.round(updatedStart * 100) / 100;
    current.end = Math.round(updatedEnd * 100) / 100;

    pushState({
      ...project,
      segments,
    });
  }, [project, pushState]);

  /**
   * Delete segment (merging its space into neighbors or marking excluded)
   */
  const deleteSegment = useCallback((segmentId: string) => {
    if (!project) return;
    if (project.segments.length <= 1) {
      // Cannot delete the only segment; toggle to excluded instead
      toggleSegmentState(segmentId);
      return;
    }

    const segments = [...project.segments];
    const idx = segments.findIndex(s => s.id === segmentId);
    if (idx === -1) return;

    const removed = segments[idx];
    segments.splice(idx, 1);

    // Expand previous or next segment to fill the gap
    if (idx > 0) {
      segments[idx - 1].end = removed.end;
    } else if (segments.length > 0) {
      segments[0].start = removed.start;
    }

    pushState({
      ...project,
      segments,
    });
  }, [project, pushState, toggleSegmentState]);

  /**
   * Reorder segment
   */
  const reorderSegment = useCallback((segmentId: string, direction: 'left' | 'right') => {
    if (!project) return;
    const segments = [...project.segments];
    const idx = segments.findIndex(s => s.id === segmentId);
    if (idx === -1) return;

    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= segments.length) return;

    // Swap states and descriptions while preserving contiguous timeline sequence
    const segA = segments[idx];
    const segB = segments[targetIdx];

    const tempState = segA.state;
    const tempLabel = segA.label;
    const tempCat = segA.category;
    const tempReason = segA.reason;

    segA.state = segB.state;
    segA.label = segB.label;
    segA.category = segB.category;
    segA.reason = segB.reason;

    segB.state = tempState;
    segB.label = tempLabel;
    segB.category = tempCat;
    segB.reason = tempReason;

    pushState({
      ...project,
      segments,
    });
  }, [project, pushState]);

  /**
   * Apply AI Highlights to the timeline:
   * Slices the full timeline into kept highlights and excluded intervals
   */
  const applyAIHighlights = useCallback((highlights: AIHighlight[]) => {
    if (!project || highlights.length === 0) return;

    const totalDur = project.metadata.duration;
    const sorted = [...highlights]
      .filter(h => h.end > h.start && h.start < totalDur)
      .sort((a, b) => a.start - b.start);

    // Merge overlapping highlights
    const merged: Array<{ start: number; end: number; title: string; category?: any; reason?: string }> = [];
    for (const h of sorted) {
      const start = Math.max(0, h.start);
      const end = Math.min(totalDur, h.end);
      const last = merged[merged.length - 1];

      if (last && start <= last.end + 1.0) {
        last.end = Math.max(last.end, end);
        last.title += ` + ${h.title}`;
      } else {
        merged.push({ start, end, title: h.title, category: h.category, reason: h.reason });
      }
    }

    const newSegments: Segment[] = [];
    let currentCursor = 0;

    for (let i = 0; i < merged.length; i++) {
      const hl = merged[i];

      // Excluded gap before highlight
      if (hl.start > currentCursor + 0.5) {
        newSegments.push({
          id: `seg-gap-${i}-${Date.now()}`,
          start: currentCursor,
          end: hl.start,
          state: 'excluded',
          label: 'Tiempo muerto / Descartado',
        });
      }

      // Kept highlight segment
      newSegments.push({
        id: `seg-hl-${i}-${Date.now()}`,
        start: hl.start,
        end: hl.end,
        state: 'kept',
        label: hl.title,
        category: hl.category,
        reason: hl.reason,
      });

      currentCursor = hl.end;
    }

    // Trailing gap
    if (currentCursor < totalDur - 0.5) {
      newSegments.push({
        id: `seg-tail-${Date.now()}`,
        start: currentCursor,
        end: totalDur,
        state: 'excluded',
        label: 'Final descartado',
      });
    }

    pushState({
      ...project,
      segments: newSegments,
    });
  }, [project, pushState]);

  const resetToSingleSegment = useCallback(() => {
    if (!project) return;
    pushState({
      ...project,
      segments: [
        {
          id: `seg-init-${Date.now()}`,
          start: 0,
          end: project.metadata.duration,
          state: 'kept',
          label: 'VOD Completo',
        },
      ],
    });
  }, [project, pushState]);

  const totalDuration = useMemo(() => {
    if (!project) return 0;
    return project.metadata.duration;
  }, [project]);

  const keptDuration = useMemo(() => {
    if (!project) return 0;
    return project.segments
      .filter(s => s.state === 'kept')
      .reduce((acc, s) => acc + (s.end - s.start), 0);
  }, [project]);

  const excludedDuration = useMemo(() => {
    if (!project) return 0;
    return Math.max(0, totalDuration - keptDuration);
  }, [project, totalDuration, keptDuration]);

  const keptPercentage = useMemo(() => {
    if (totalDuration <= 0) return 100;
    return Math.min(100, Math.round((keptDuration / totalDuration) * 100));
  }, [totalDuration, keptDuration]);

  return {
    project,
    loadProject,
    closeProject,
    splitAt,
    toggleSegmentState,
    setSegmentState,
    trimSegment,
    deleteSegment,
    reorderSegment,
    applyAIHighlights,
    resetToSingleSegment,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
    totalDuration,
    keptDuration,
    excludedDuration,
    keptPercentage,
  };
}
