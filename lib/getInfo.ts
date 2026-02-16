import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl, getPlayerUrlWithOptions } from "./getPlayerUrl";
import { torAgent, shouldPreferTor, hostNeedsTor } from "./proxyAgents";

/**
 * High-Performance Mirror Resolver
 * Uses massive parallel racing and persistent connection pooling to find stream links in seconds.
 */
export default async function getInfo(id: string) {
  try {
    // 1. Concurrent Player Discovery
    const [primaryPlayerUrl, refreshedPlayerUrl] = await Promise.all([
      getPlayerUrl(),
      getPlayerUrlWithOptions(true)
    ]);

    const fallbackPlayerUrls = [
      process.env.FALLBACK_PLAYER_URL_1 || "",
      process.env.FALLBACK_PLAYER_URL_2 || "",
      "https://heast404jax.com",
      "https://vekna402las.com"
    ];

    const domains = Array.from(new Set(
      [primaryPlayerUrl, refreshedPlayerUrl, ...fallbackPlayerUrls]
        .map((u) => String(u || "").trim().replace(/\/$/, ""))
        .filter(Boolean)
    ));

    const paths = [`/play/${id}`, `/play/${id}?tr=1`, `/play/${id}?tr=2`, `/v/${id}`, `/watch/${id}`];
    const refererCandidates = ["https://allmovieland.link/", "https://google.com/"];

    let resolvedData: any = null;
    let foundPotentialMetadata = false;

    console.log(`[getInfo] Racing ${domains.length} domains for ID: ${id}`);

    // 2. Race Generation: Flatten all domain/path/referer combinations into a single set of parallel tasks
    const tasks: Promise<void>[] = [];

    for (const domain of domains) {
      const perDomainReferers = Array.from(new Set([`${domain}/`, ...refererCandidates]));

      for (const path of paths) {
        const targetUrl = `${domain}${path}`;

        for (const referer of perDomainReferers) {
          tasks.push((async () => {
            if (resolvedData) return;

            try {
              const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": referer,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Cache-Control": "no-cache"
              };

              const useTor = shouldPreferTor(targetUrl) || hostNeedsTor.has(new URL(targetUrl).hostname);
              let response: any;

              const fetchOptions = {
                headers,
                timeout: useTor ? 20000 : 8000,
                httpAgent: useTor ? torAgent : undefined,
                httpsAgent: useTor ? torAgent : undefined,
                validateStatus: (s: number) => s === 200
              };

              try {
                response = await axios.get(targetUrl, fetchOptions);
                console.log(`[getInfo] Fetch Success: ${targetUrl} (${response.data ? String(response.data).length : 0} bytes)`);
              } catch (err: any) {
                if (!useTor && (err.code === 'ECONNABORTED' || err.response?.status === 403 || err.response?.status === 404)) {
                  console.warn(`[getInfo] Fetch Failed (Retryable): ${targetUrl} - ${err.message}`);
                  return;
                } else {
                  console.error(`[getInfo] Fetch Error: ${targetUrl} - ${err.response?.status || err.code}`);
                  return;
                }
              }

              if (!response || !response.data) return;

              const html = String(response.data);
              // Broader check for metadata: file, sources, playlist, etc.
              if (!html.includes("file") && !html.includes("sources") && !html.includes("playlist")) {
                return;
              }

              const $ = cheerio.load(html);
              const scripts = $("script").map((i, el) => $(el).html()).get();
              console.log(`[getInfo] Found ${scripts.length} scripts at ${targetUrl}`);

              for (const script of scripts) {
                if (resolvedData) return;
                if (!script) continue;

                // 1. Try to find 'file' or 'sources' or 'playlist'
                const fileMatch = script.match(/["']?(file|sources|playlist)["']?\s*[:=]\s*["']([^"']+)["']/);
                const keyMatch = script.match(/["']?key["']?\s*[:=]\s*["']([^"']+)["']/);

                if (fileMatch && fileMatch[2]) {
                  console.log(`[getInfo] Match found in script! file: ${fileMatch[2].substring(0, 50)}...`);
                  foundPotentialMetadata = true;
                  let file = fileMatch[2].replace(/\\\//g, "/"); // Unescape JSON-escaped slashes
                  const key = (keyMatch ? keyMatch[2] : "").replace(/\\\//g, "/");

                  // Handle potential Base64 encoding
                  if (!file.startsWith('http') && !file.startsWith('/') && !file.includes('.') && /^[A-Za-z0-9+/=]+$/.test(file)) {
                    try {
                      const decoded = Buffer.from(file, 'base64').toString('utf-8');
                      if (decoded.startsWith('http') || decoded.startsWith('/') || decoded.includes('.m3u8')) file = decoded;
                    } catch { }
                  }

                  let playlistUrl = "";
                  try {
                    if (file.startsWith("http")) {
                      playlistUrl = file;
                    } else if (file.startsWith("//")) {
                      playlistUrl = `https:${file}`;
                    } else {
                      // Use URL constructor for safe joining
                      const base = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
                      playlistUrl = new URL(file, base).href;
                    }
                    // Final sanitization of any weird double slashes in path (safely)
                    const u = new URL(playlistUrl);
                    u.pathname = u.pathname.replace(/\/+/g, '/');
                    playlistUrl = u.href;
                  } catch (err) {
                    console.error(`[getInfo] URL Construction failed for file=${file}, domain=${domain}`);
                    playlistUrl = file;
                  }

                  try {
                    console.log(`[getInfo] Validating playlist: ${playlistUrl} for ID: ${id}`);
                    const playlistRes = await axios.get(playlistUrl, {
                      headers: {
                        "User-Agent": headers["User-Agent"],
                        "Referer": targetUrl,
                        "X-Csrf-Token": key || "0",
                        "Accept": "*/*"
                      },
                      timeout: 12000
                    });

                    let playlist: any[] = [];
                    if (Array.isArray(playlistRes.data)) {
                      playlist = playlistRes.data;
                    } else if (playlistRes.data && typeof playlistRes.data === 'object' && playlistRes.data.list) {
                      playlist = playlistRes.data.list;
                    } else if (typeof playlistRes.data === 'string' && (playlistRes.data.includes('#EXTM3U') || playlistRes.data.includes('playlist') || playlistRes.data.includes('m3u8'))) {
                      // It's a direct HLS manifest! Convert to internal format
                      playlist = [{ file: playlistUrl, label: "Auto", type: "hls" }];
                    }

                    playlist = playlist.filter((item: any) => item && (item.file || item.folder || item.src));

                    if (playlist.length > 0 && !resolvedData) {
                      console.log(`[getInfo] SUCCESS: Found ${playlist.length} tracks at ${targetUrl}`);
                      resolvedData = { success: true, data: { playlist, key } };
                      return;
                    }
                  } catch (e: any) {
                    console.warn(`[getInfo] Validation failed for ${playlistUrl}: ${e.message}`);

                    // Fallback: If it's a direct .m3u8 link, try to use it even if validation fetch failed (might be CORS or referer issues on our end)
                    if (playlistUrl.includes('.m3u8') && !resolvedData) {
                      console.log(`[getInfo] Using fallback HLS link: ${playlistUrl}`);
                      resolvedData = { success: true, data: { playlist: [{ file: playlistUrl, label: "Stream (Fallback)", type: "hls" }], key } };
                      return;
                    }
                  }
                }
              }
            } catch { }
          })());
        }
      }
    }

    // 3. Orchestrate the race
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Resolution Timeout")), 30000));

    await Promise.race([
      Promise.all(tasks),
      timeoutPromise
    ]).catch((err) => {
      console.warn(`[getInfo] Race completed with timeout or error for ${id}: ${err.message}`);
    });

    if (resolvedData) return resolvedData;

    return {
      success: false,
      message: foundPotentialMetadata
        ? "Stream found but the provider has no video files yet (media likely unreleased)."
        : "Media not found on any known mirrors."
    };

  } catch (error: any) {
    return { success: false, message: `API Error: ${error.message}` };
  }
}
