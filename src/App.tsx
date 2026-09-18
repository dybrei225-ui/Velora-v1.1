import React, { useState, useCallback, useEffect } from 'react';
import { useProject } from './hooks/useProject.js';
import { Header } from './components/common/Header.js';
import { HomeView } from './components/home/HomeView.js';
import { VideoPlayer } from './components/editor/VideoPlayer.js';
import { Timeline } from './components/editor/Timeline.js';
import { AiModePanel } from './components/editor/AiModePanel.js';
import { ExportModal } from './components/export/ExportModal.js';

export function App() {
  const {
    project,
    loadProject,
    closeProject,
    splitAt,
    toggleSegmentState,
    trimSegment,
    deleteSegment,
    reorderSegment,
    applyAIHighlights,
    undo,
    redo,
    canUndo,
    canRedo,
    totalDuration,
    keptDuration,
  } = useProject();

  const [currentTime, setCurrentTime] = useState(0);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isPreviewResultActive, setIsPreviewResultActive] = useState(false);

  // Global Undo / Redo keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [undo, redo]);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleSeek = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleSplitAtCurrentTime = useCallback(() => {
    splitAt(currentTime);
  }, [splitAt, currentTime]);

  if (!project) {
    return <HomeView onProjectLoaded={loadProject} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#070709] text-gray-200 overflow-hidden select-none">
      {/* Top Header Bar */}
      <Header
        project={project}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onCloseProject={closeProject}
        onOpenAiPanel={() => setIsAiPanelOpen(prev => !prev)}
        isAiPanelOpen={isAiPanelOpen}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        isPreviewResultActive={isPreviewResultActive}
        onTogglePreviewResult={() => setIsPreviewResultActive(prev => !prev)}
        onSplitAtPlayhead={handleSplitAtCurrentTime}
        totalDuration={totalDuration}
        keptDuration={keptDuration}
      />

      {/* Main Workspace: Video + Timeline and lateral AI panel */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Editor Main Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#070709]">
          {/* Top Half: Video Player */}
          <div className="flex-1 min-h-[300px] relative overflow-hidden bg-black flex items-center justify-center">
            <VideoPlayer
              sourceUrl={project.sourceUrl}
              isHls={project.isHls}
              segments={project.segments}
              currentTime={currentTime}
              fps={project.metadata.fps || 30}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={(dur) => {
                if (dur && project.metadata.duration === 0) {
                  project.metadata.duration = dur;
                }
              }}
              onSplit={splitAt}
              isPreviewResultActive={isPreviewResultActive}
              onTogglePreviewResult={() => setIsPreviewResultActive(prev => !prev)}
            />
          </div>

          {/* Bottom Half: Interactive Timeline Scrubber */}
          <div className="shrink-0">
            <Timeline
              segments={project.segments}
              totalDuration={totalDuration || 300}
              currentTime={currentTime}
              onSeek={handleSeek}
              onSplit={splitAt}
              onToggleState={toggleSegmentState}
              onTrim={trimSegment}
              onReorder={reorderSegment}
              onDelete={deleteSegment}
            />
          </div>
        </div>

        {/* AI Mode Lateral Panel */}
        <AiModePanel
          project={project}
          isOpen={isAiPanelOpen}
          onClose={() => setIsAiPanelOpen(false)}
          onApplyHighlights={applyAIHighlights}
          onPreviewTimestamp={handleSeek}
        />
      </div>

      {/* Export Modal */}
      <ExportModal
        project={project}
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        keptDuration={keptDuration}
      />
    </div>
  );
}

export default App;
