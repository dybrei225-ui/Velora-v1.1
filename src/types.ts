export type SegmentState = 'kept' | 'excluded';

export type HighlightCategory = 
  | 'reaccion' 
  | 'victoria' 
  | 'derrota' 
  | 'humor' 
  | 'tension' 
  | 'conversacion'
  | 'destacado';

export interface Segment {
  id: string;
  start: number; // in seconds (can be float for millisecond accuracy)
  end: number;   // in seconds
  state: SegmentState;
  label?: string;
  category?: HighlightCategory;
  reason?: string;
}

export type SourceType = 'kick' | 'local' | 'hls' | 'demo';

export interface VideoMetadata {
  duration: number; // in seconds
  width?: number;
  height?: number;
  fps?: number;
  codecVideo?: string;
  codecAudio?: string;
  bitrate?: number;
  format?: string;
  title?: string;
  channel?: string;
  thumbnailUrl?: string;
}

export interface Project {
  id: string;
  name: string;
  sourceType: SourceType;
  sourceUrl: string; // Direct URL, stream URL, proxy URL or local blob/server path
  originalUrl?: string; // Original user input URL (e.g. kick.com/video/...)
  isHls: boolean;
  localFilePath?: string; // If uploaded to backend
  metadata: VideoMetadata;
  segments: Segment[];
  createdAt: number;
}

export interface AIHighlight {
  id: string;
  start: number;
  end: number;
  title: string;
  category: HighlightCategory;
  reason: string;
  confidence?: number;
}

export type ExportMode = 'auto' | 'stream-copy' | 'precise' | 'hybrid';
export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ExportJob {
  id: string;
  projectId: string;
  status: ExportStatus;
  mode: ExportMode;
  progress: number; // 0 to 100
  stage: string;
  outputFileName?: string;
  downloadUrl?: string;
  fileSize?: number;
  duration?: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface AcousticAnalysisResult {
  peaks: Array<{ time: number; energy: number; description: string }>;
  silences: Array<{ start: number; end: number; duration: number }>;
  averageVolumeDb: number;
}
