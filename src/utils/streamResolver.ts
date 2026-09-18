/**
 * Stream URL Resolver Strategy:
 *
 * 1. Already Proxied Check:
 *    If the stream URL already starts with '/api/kick/proxy', retain it without modification.
 *
 * 2. Non-HLS Streams:
 *    Direct video files (e.g., .mp4, .webm, object URLs) are loaded directly by standard HTML5 video.
 *
 * 3. Verified Public Open-CORS Providers:
 *    Streams hosted on CDNs confirmed by live CORS testing (Access-Control-Allow-Origin: *)
 *    such as 'test-streams.mux.dev' and 'cdn.plyr.io' are loaded directly without routing
 *    through the Express proxy. This eliminates server hops, latency, and iframe auth cookie redirects.
 *
 * 4. Restricted Streaming Providers (Kick / Cloudflare / Akamai):
 *    Streams from Kick (kick.com, *.cloudfront.net, *.akamaized.net, etc.) that enforce
 *    referrer/origin checks or lack permissive CORS headers are routed through '/api/kick/proxy'
 *    to inject browser headers and rewrite inner .m3u8 playlists/segments.
 *
 * 5. Dynamic In-Browser CORS Verification for Unknown HLS Sources:
 *    For any unrecognized external HLS source, a lightweight in-browser Range/HEAD request is
 *    performed with CORS mode. If the browser receives a valid response with CORS headers,
 *    it is loaded directly. If CORS fails, it automatically falls back to '/api/kick/proxy'.
 */

export async function resolveStreamPlaybackUrl(rawUrl: string): Promise<string> {
  if (!rawUrl) return '';

  const trimmed = rawUrl.trim();

  // 1. Already routed via proxy or local endpoint
  if (trimmed.startsWith('/api/kick/proxy') || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  // 2. Non-HLS streams don't need manifest URL rewrites
  if (!trimmed.includes('.m3u8')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    // 3. Known and verified open-CORS providers (proven to serve Access-Control-Allow-Origin: *)
    if (host.includes('test-streams.mux.dev') || host.includes('plyr.io')) {
      return trimmed;
    }

    // 4. Known restricted providers requiring CORS proxy and Referer spoofing
    const isRestrictedProvider =
      host.includes('kick.com') ||
      host.includes('cloudfront.net') ||
      host.includes('akamaized.net') ||
      host.includes('fastly.net') ||
      host.includes('live-video.net');

    if (isRestrictedProvider) {
      return `/api/kick/proxy?url=${encodeURIComponent(trimmed)}`;
    }

    // 5. Active test for unknown public HLS sources
    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
      try {
        const testRes = await fetch(trimmed, {
          method: 'GET',
          headers: { Range: 'bytes=0-128' },
          mode: 'cors',
          signal: AbortSignal.timeout(3000),
        });

        if (testRes.ok || testRes.status === 206) {
          // Source successfully loaded directly with CORS!
          return trimmed;
        }
      } catch {
        // CORS blocked or network failure, use proxy fallback
        return `/api/kick/proxy?url=${encodeURIComponent(trimmed)}`;
      }
    }

    return `/api/kick/proxy?url=${encodeURIComponent(trimmed)}`;
  } catch {
    return trimmed;
  }
}
