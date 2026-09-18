import https from 'https';
import http from 'http';
import { URL } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface KickResolvedVideo {
  id: string;
  title: string;
  channel: string;
  duration: number; // seconds
  thumbnailUrl: string;
  streamUrl: string; // m3u8 or mp4
  isHls: boolean;
  createdAt?: string;
}

// User-Agent simulating modern browser to avoid basic Cloudflare / bot scrapers
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Executes a network fetch using curl to bypass Cloudflare anti-bot TLS fingerprint blocks,
 * with graceful fallback to Node.js fetchWithTimeout.
 */
async function fetchKickHttp(url: string, headers: Record<string, string> = {}, timeoutMs = 12000): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const curlHeaders: string[] = [];
    const mergedHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://kick.com/',
      ...headers,
    };

    for (const [key, value] of Object.entries(mergedHeaders)) {
      curlHeaders.push('-H', `${key}: ${value}`);
    }

    const { stdout } = await execFileAsync('curl', [
      '-s',
      '-L',
      '--max-time', String(Math.ceil(timeoutMs / 1000)),
      url,
      ...curlHeaders,
    ], { maxBuffer: 15 * 1024 * 1024 });

    return { ok: true, status: 200, body: stdout };
  } catch (curlErr: any) {
    // If curl failed or timed out, attempt standard fetch as secondary fallback
    try {
      const res = await fetchWithTimeout(url, { headers }, timeoutMs);
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text };
    } catch {
      return { ok: false, status: 500, body: '' };
    }
  }
}

// Set of known and recently accessed Kick streamer channels for automatic fallback resolution
const KNOWN_CHANNELS = new Set<string>([
  'edwinmendozza',
  'xqc',
  'westcol',
  'trainwreckstv',
  'adinross',
  'elxokas',
  'rubius',
  'auronplay',
  'ibai',
  'paulbody',
]);

/**
 * Extracts VOD metadata and HLS master recording_url from a Kick Next.js HTML page
 */
function parseKickHtmlPage(pageHtml: string, videoId: string, fallbackChannel: string): KickResolvedVideo | null {
  if (!pageHtml) return null;

  if (
    pageHtml.includes('NEXT_HTTP_ERROR_FALLBACK;404') ||
    pageHtml.includes('Video not found') ||
    pageHtml.includes('No query results for model')
  ) {
    return null;
  }

  // Extract recording_url (.m3u8 master manifest)
  const recordingUrlMatch =
    pageHtml.match(/\\?"recording_url\\?":\s*\\?"(https:[^"\\\\]+master\.m3u8)\\?"/) ||
    pageHtml.match(/https:\/\/stream\.kick\.com\/[^"'\s\\]+master\.m3u8/) ||
    pageHtml.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);

  if (!recordingUrlMatch) return null;

  const streamUrl = recordingUrlMatch[1] || recordingUrlMatch[0];

  // Extract Title: prefer og:description or title near viewer_count, avoid generic i18n strings
  let title = '';
  const ogDescMatch = pageHtml.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  const jsonTitleMatch = pageHtml.match(/\\?"title\\?":\s*\\?"([^"\\]+)\\",\s*\\?"viewer_count\\?"/);
  const ogTitleMatch = pageHtml.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);

  if (ogDescMatch && ogDescMatch[1] && ogDescMatch[1].trim() && !ogDescMatch[1].includes('Watch the VOD')) {
    title = ogDescMatch[1].trim();
  } else if (jsonTitleMatch && jsonTitleMatch[1] && jsonTitleMatch[1].trim()) {
    title = jsonTitleMatch[1].trim();
  } else if (ogTitleMatch && ogTitleMatch[1]) {
    title = ogTitleMatch[1].replace(/\s*-\s*Watch the VOD on Kick/i, '').trim();
  } else {
    title = `Kick VOD ${videoId.slice(0, 8)}`;
  }

  // Extract Channel
  const channelDataMatch =
    pageHtml.match(/\\?"channel\\?":\s*\{[^}]*\\?"slug\\?":\s*\\?"([^"\\]+)\\"/i) ||
    pageHtml.match(/\\?"username\\?":\s*\\?"([^"\\]+)\\"/i);
  const resolvedChannel = channelDataMatch ? channelDataMatch[1] : (fallbackChannel || 'Kick Streamer');

  // Extract Duration (seconds): specifically look for duration in the video details block
  const durationMatch =
    pageHtml.match(/\\?"duration\\?":\s*(\d+),\s*\\?"end_time\\?"/) ||
    pageHtml.match(/\\?"duration\\?":\s*(\d+)/);
  const duration = durationMatch ? parseInt(durationMatch[1], 10) : 3600;

  // Extract Thumbnail
  const thumbMatch =
    pageHtml.match(/\\?"thumbnail\\?":\s*\{[^}]*\\?"src\\?":\s*\\?"(https:[^"\\]+)\\"/i) ||
    pageHtml.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  const thumbnailUrl = thumbMatch ? thumbMatch[1] : 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80';

  return {
    id: videoId,
    title,
    channel: resolvedChannel,
    duration: duration > 0 ? duration : 3600,
    thumbnailUrl,
    streamUrl,
    isHls: true,
  };
}

export async function resolveKickUrl(inputUrl: string): Promise<KickResolvedVideo> {
  const trimmed = inputUrl.trim();

  // 1. Explicit test streams / demo streams
  if (trimmed.includes('test-streams.mux.dev') || trimmed.toLowerCase() === 'demo' || trimmed.toLowerCase() === 'test') {
    return {
      id: 'demo-test-stream',
      title: 'Demo Test Stream (Big Buck Bunny - Mux HLS)',
      channel: 'Velora Demo Stream',
      duration: 596,
      thumbnailUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
      streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      isHls: true,
    };
  }

  // 2. Direct HLS or MP4 stream URLs provided by user
  if (trimmed.endsWith('.m3u8') || trimmed.includes('.m3u8?')) {
    return {
      id: 'hls-' + Date.now(),
      title: 'Transmisión HLS Externa',
      channel: 'Fuente HLS Directa',
      duration: 3600,
      thumbnailUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
      streamUrl: trimmed,
      isHls: true,
    };
  }

  if (trimmed.endsWith('.mp4') || trimmed.includes('.mp4?')) {
    return {
      id: 'mp4-' + Date.now(),
      title: 'Video Directo (MP4)',
      channel: 'Fuente de Video Directa',
      duration: 600,
      thumbnailUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
      streamUrl: trimmed,
      isHls: false,
    };
  }

  // 3. Parse Kick URL structure:
  // Examples:
  // - https://kick.com/edwinmendozza/videos/01a0b3df-02a0-7fea-b49c-877c336673e0
  // - https://kick.com/edwinmendozza/video/01a0b3df-02a0-7fea-b49c-877c336673e0
  // - https://kick.com/video/01a0b3df-02a0-7fea-b49c-877c336673e0
  // - https://kick.com/edwinmendozza
  // - 01a0b3df-02a0-7fea-b49c-877c336673e0 (UUID)
  const cleanInput = trimmed.split('?')[0].split('#')[0].replace(/\/+$/, '');

  let channel = '';
  let videoId = '';

  const channelVodMatch = cleanInput.match(/kick\.com\/([a-zA-Z0-9_\-]+)\/videos?\/([a-fA-F0-9\-]+)/i);
  if (channelVodMatch) {
    channel = channelVodMatch[1];
    videoId = channelVodMatch[2];
  } else {
    const genericVodMatch = cleanInput.match(/(?:kick\.com\/)?videos?\/([a-fA-F0-9\-]+)/i);
    if (genericVodMatch) {
      videoId = genericVodMatch[1];
    } else {
      const directUuidMatch = cleanInput.match(/^[a-fA-F0-9\-]{8,}$/);
      if (directUuidMatch) {
        videoId = cleanInput;
      }
    }

    const channelMatch = cleanInput.match(/kick\.com\/([a-zA-Z0-9_\-]+)/i);
    if (channelMatch && !['video', 'videos', 'categories', 'search', 'following', 'browse'].includes(channelMatch[1].toLowerCase())) {
      channel = channelMatch[1];
    }
  }

  // 4. Case A: A specific VOD (UUID) is requested
  if (videoId) {
    // 4.1 If channel is specified, try the direct channel VOD page first
    if (channel) {
      KNOWN_CHANNELS.add(channel.toLowerCase());
      const targetVodUrl = `https://kick.com/${channel}/videos/${videoId}`;
      const { body: pageHtml } = await fetchKickHttp(targetVodUrl);

      if (pageHtml) {
        if (
          pageHtml.includes('"is_private":true') ||
          pageHtml.includes('"status":"private"') ||
          pageHtml.includes('\\"is_private\\":true') ||
          pageHtml.includes('\\"status\\":\\"private\\"')
        ) {
          throw new Error('Este VOD de Kick es privado y no está disponible para reproducción pública.');
        }

        if (
          pageHtml.includes('"status":"processing"') ||
          pageHtml.includes('\\"status\\":\\"processing\\"')
        ) {
          throw new Error('El VOD de Kick todavía se está procesando. Intenta de nuevo en unos minutos.');
        }

        const parsed = parseKickHtmlPage(pageHtml, videoId, channel);
        if (parsed) {
          return parsed;
        }
      }

      // Check channel videos API
      const channelApiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}/videos`;
      const { body: apiBody } = await fetchKickHttp(channelApiUrl, { 'Accept': 'application/json' });

      if (apiBody && (apiBody.startsWith('[') || apiBody.startsWith('{'))) {
        try {
          const videos = JSON.parse(apiBody);
          if (Array.isArray(videos)) {
            const found = videos.find(
              (v: any) =>
                v.video?.uuid === videoId ||
                String(v.id) === videoId ||
                String(v.video?.id) === videoId
            );

            if (found && found.source) {
              return {
                id: videoId,
                title: found.session_title || `Kick VOD ${videoId.slice(0, 8)}`,
                channel,
                duration: found.duration ? Math.round(Number(found.duration) / 1000) : 3600,
                thumbnailUrl: found.thumbnail?.src || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
                streamUrl: found.source,
                isHls: found.source.includes('.m3u8'),
                createdAt: found.created_at,
              };
            }
          }
        } catch {
          // JSON parse failure ignored
        }
      }
    }

    // 4.2 Check direct video API endpoint (works if videoId is video.uuid or numeric ID)
    try {
      const { body: directVideoBody } = await fetchKickHttp(`https://kick.com/api/v1/video/${encodeURIComponent(videoId)}`, { 'Accept': 'application/json' });
      if (directVideoBody && directVideoBody.startsWith('{')) {
        const videoData = JSON.parse(directVideoBody);
        if (videoData.source) {
          const resolvedCh = videoData.livestream?.channel?.slug || channel || 'Kick Streamer';
          KNOWN_CHANNELS.add(resolvedCh.toLowerCase());
          return {
            id: videoId,
            title: videoData.livestream?.session_title || `Kick VOD ${videoId.slice(0, 8)}`,
            channel: resolvedCh,
            duration: videoData.livestream?.duration ? Math.round(Number(videoData.livestream.duration) / 1000) : 3600,
            thumbnailUrl: videoData.livestream?.thumbnail?.url || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
            streamUrl: videoData.source,
            isHls: videoData.source.includes('.m3u8'),
            createdAt: videoData.created_at,
          };
        }
      }
    } catch {}

    // 4.3 If channel was not specified (e.g. user pasted /video/{uuid} or just UUID),
    // check candidate channels from KNOWN_CHANNELS
    if (!channel) {
      for (const cand of KNOWN_CHANNELS) {
        try {
          const candVodUrl = `https://kick.com/${cand}/videos/${videoId}`;
          const { body: candHtml } = await fetchKickHttp(candVodUrl);
          const parsed = parseKickHtmlPage(candHtml, videoId, cand);
          if (parsed) {
            KNOWN_CHANNELS.add(cand);
            return parsed;
          }
        } catch {}
      }

      throw new Error(`Kick requiere el nombre del canal en el enlace del VOD (por ejemplo: https://kick.com/{canal}/videos/${videoId}). Por favor, ingresa el enlace completo con el canal.`);
    }

    // Never return the Mux test video as a silent fallback for a real Kick VOD
    throw new Error(`No se encontró una transmisión reproducible para el VOD "${videoId}". Comprueba que el video sea público y esté disponible en Kick.`);
  }

  // 5. Case B: A channel URL was provided without a specific videoId (e.g. https://kick.com/edwinmendozza)
  if (channel) {
    // Check if the channel is live right now
    const channelLiveUrl = `https://kick.com/api/v1/channels/${encodeURIComponent(channel)}`;
    const { body: liveBody } = await fetchKickHttp(channelLiveUrl, { 'Accept': 'application/json' });

    if (liveBody) {
      try {
        const liveData = JSON.parse(liveBody);
        if (liveData.playback_url) {
          return {
            id: `live-${channel}-${Date.now()}`,
            title: liveData.livestream?.session_title || `Transmisión en Vivo - ${liveData.user?.username || channel}`,
            channel: liveData.user?.username || channel,
            duration: 7200, // Live streams have dynamic duration
            thumbnailUrl: liveData.livestream?.thumbnail?.url || liveData.user?.profile_pic || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
            streamUrl: liveData.playback_url,
            isHls: true,
          };
        }
      } catch {
        // Continue to recent VODs
      }
    }

    // If channel is not currently live, attempt to load their latest public VOD
    const channelVideosUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}/videos`;
    const { body: vodsBody } = await fetchKickHttp(channelVideosUrl, { 'Accept': 'application/json' });

    if (vodsBody) {
      try {
        const vods = JSON.parse(vodsBody);
        if (Array.isArray(vods) && vods.length > 0 && vods[0].source) {
          const latest = vods[0];
          return {
            id: latest.video?.uuid || String(latest.id),
            title: `[Último VOD] ${latest.session_title || channel}`,
            channel,
            duration: latest.duration ? Math.round(Number(latest.duration) / 1000) : 3600,
            thumbnailUrl: latest.thumbnail?.src || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
            streamUrl: latest.source,
            isHls: latest.source.includes('.m3u8'),
            createdAt: latest.created_at,
          };
        }
      } catch {
        // Fall through to error
      }
    }

    throw new Error(`El canal "${channel}" no está transmitiendo en vivo en este momento y no tiene VODs públicos disponibles.`);
  }

  throw new Error('URL de Kick no reconocida. Ingresa un enlace en formato https://kick.com/{canal}/videos/{uuid} o un stream .m3u8 directo.');
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Proxies an HLS or video segment request, adding CORS headers and rewriting manifest URLs if needed.
 */
export async function proxyHlsRequest(
  targetUrl: string,
  baseUrlForRewrites: string,
  clientHeaders?: Record<string, string | string[] | undefined>
): Promise<{
  statusCode: number;
  contentType: string;
  headers: Record<string, string>;
  data: Buffer | string;
  isManifest: boolean;
}> {
  const parsedUrl = new URL(targetUrl);
  const isKickDomain = parsedUrl.host.includes('kick.com') || parsedUrl.host.includes('cloudfront.net');

  const forwardHeaders: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    'Accept': '*/*',
  };

  if (isKickDomain) {
    forwardHeaders['Referer'] = 'https://kick.com/';
    forwardHeaders['Origin'] = 'https://kick.com';
  }

  // Forward client Range request if available
  if (clientHeaders && clientHeaders['range']) {
    forwardHeaders['Range'] = String(clientHeaders['range']);
  }

  // Explicit timeout with AbortController (20 seconds)
  const controller = new AbortController();
  const timeoutMs = 20000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      headers: forwardHeaders,
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    clearTimeout(timeoutId);
    if (fetchErr.name === 'AbortError' || controller.signal.aborted) {
      const timeoutError: any = new Error(`Gateway Timeout: La solicitud externa HLS excedió ${timeoutMs / 1000}s (${targetUrl})`);
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    const networkError: any = new Error(`Error de conexión HLS: ${fetchErr.message}`);
    networkError.statusCode = 502;
    throw networkError;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok && response.status !== 206) {
    const targetErr: any = new Error(`Proxy target returned HTTP ${response.status}: ${response.statusText}`);
    targetErr.statusCode = response.status >= 500 ? 502 : response.status;
    throw targetErr;
  }

  const responseHeaders: Record<string, string> = {};
  const contentRange = response.headers.get('content-range');
  if (contentRange) {
    responseHeaders['Content-Range'] = contentRange;
  }
  const acceptRanges = response.headers.get('accept-ranges');
  if (acceptRanges) {
    responseHeaders['Accept-Ranges'] = acceptRanges;
  }

  let contentType = response.headers.get('content-type') || '';
  const pathname = parsedUrl.pathname.toLowerCase();

  const isManifest = pathname.endsWith('.m3u8') ||
    contentType.includes('mpegurl') ||
    contentType.includes('application/x-mpegurl');

  if (isManifest) {
    const text = await response.text();
    // Rewrite internal URLs so secondary playlists and .ts segments pass through /api/kick/proxy
    const rewritten = rewriteM3u8Manifest(text, targetUrl, baseUrlForRewrites);
    return {
      statusCode: response.status,
      contentType: 'application/vnd.apple.mpegurl; charset=utf-8',
      headers: responseHeaders,
      data: rewritten,
      isManifest: true,
    };
  }

  // Set standard MIME types for video segments to avoid MSE decoder issues
  if (pathname.endsWith('.ts')) {
    contentType = 'video/mp2t';
  } else if (pathname.endsWith('.mp4') || pathname.endsWith('.m4s')) {
    contentType = 'video/mp4';
  } else if (!contentType) {
    contentType = 'application/octet-stream';
  }

  // Never convert binary video segment responses to text
  const arrayBuf = await response.arrayBuffer();
  return {
    statusCode: response.status,
    contentType,
    headers: responseHeaders,
    data: Buffer.from(arrayBuf),
    isManifest: false,
  };
}

function rewriteM3u8Manifest(manifest: string, manifestUrl: string, proxyEndpoint: string): string {
  // Normalize Windows CRLF line endings to prevent carriage return corruption
  const lines = manifest.replace(/\r/g, '').split('\n');

  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Handle URI="something" inside tags like #EXT-X-KEY or #EXT-X-MAP
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
          try {
            const absolute = uri.startsWith('http://') || uri.startsWith('https://')
              ? uri
              : new URL(uri, manifestUrl).toString();
            return `URI="${proxyEndpoint}?url=${encodeURIComponent(absolute)}"`;
          } catch {
            return `URI="${uri}"`;
          }
        });
      }
      return trimmed;
    }

    // It's a segment or sub-playlist URL - resolve relative to the manifest URL using new URL(url, manifestUrl)
    try {
      const absolute = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : new URL(trimmed, manifestUrl).toString();
      return `${proxyEndpoint}?url=${encodeURIComponent(absolute)}`;
    } catch {
      return trimmed;
    }
  }).join('\n');
}
