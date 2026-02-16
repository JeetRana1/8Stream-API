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

    const paths = [
      `/play/${id}`, `/play/${id}?tr=1`, `/play/${id}?tr=2`, `/play/${id}?tr=3`,
      `/play/${id}?tr=4`, `/play/${id}?tr=5`,
      `/v/${id}`, `/watch/${id}`, `/watch/${id}?tr=1`, `/watch/${id}?tr=2`
    ];
    const refererCandidates = [
      "https://allmovieland.link/",
      "https://google.com/",
      "https://vidsrc.me/",
      `https://allmovieland.io/play/${id}`,
      "https://w1.vidsrc.xyz/"
    ];

    let resolvedData: any = null;
    let foundPotentialMetadata = false;

    console.log(`[getInfo] RACING ${domains.length} domains against ${paths.length} paths for ID: ${id}`);

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
                const status = err.response?.status;
                if (!useTor && (status === 503 || status === 403 || status === 429)) {
                  console.warn(`[getInfo] Blocked (503/403) at ${targetUrl}. Re-tasking with Tor...`);
                  // Force Tor for this specific URL in a one-off retry
                  try {
                    response = await axios.get(targetUrl, { ...fetchOptions, httpAgent: torAgent, httpsAgent: torAgent, timeout: 20000 });
                    console.log(`[getInfo] Tor Retry Success: ${targetUrl}`);
                  } catch (retryErr) { return; }
                } else if (!useTor && (err.code === 'ECONNABORTED' || status === 404)) {
                  return;
                } else {
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
                  const rawFile = fileMatch[2].replace(/\\\/|\\\//g, "/"); // Deep unescape
                  const key = (keyMatch ? keyMatch[2] : "").replace(/\\\/|\\\//g, "/");

                  // Handle potential Base64 encoding
                  let file = rawFile;
                  if (!file.startsWith('http') && !file.startsWith('/') && !file.includes('.') && /^[A-Za-z0-9+/=]+$/.test(file)) {
                    try {
                      const decoded = Buffer.from(file, 'base64').toString('utf-8');
                      if (decoded.startsWith('http') || decoded.startsWith('/') || decoded.includes('.m3u8')) {
                        file = decoded;
                      }
                    } catch { }
                  }

                  let playlistUrl = "";
                  try {
                    const domainForBase = domain.startsWith('http') ? domain : `https://${domain}`;
                    const baseOrigin = new URL(domainForBase).origin;

                    if (file.startsWith("http")) {
                      playlistUrl = file;
                    } else if (file.startsWith("//")) {
                      playlistUrl = `https:${file}`;
                    } else {
                      // Handle paths starting with ~ or just plain filenames
                      const cleanPath = file.startsWith('/') ? file : (file.startsWith('~') ? `/${file}` : `/${file}`);
                      playlistUrl = new URL(cleanPath, baseOrigin).href;
                    }

                    const finalUrl = new URL(playlistUrl);
                    finalUrl.pathname = finalUrl.pathname.replace(/\/+/g, '/');
                    playlistUrl = finalUrl.href;
                  } catch (err) {
                    playlistUrl = file.startsWith('http') ? file : `${domain}/${file.replace(/^\//, '')}`;
                  }

                  // We found SOMETHING that looks like metadata
                  foundPotentialMetadata = true;

                  try {
                    console.log(`[getInfo] Found candidate: ${playlistUrl} (ID: ${id})`);

                    const fetchPlaylist = async (useTorAgent: boolean) => {
                      return await axios.get(playlistUrl, {
                        headers: {
                          "User-Agent": headers["User-Agent"],
                          "Referer": targetUrl,
                          "X-Csrf-Token": key || "0",
                          "Accept": "*/*"
                        },
                        timeout: useTorAgent ? 15000 : 10000,
                        httpAgent: useTorAgent ? torAgent : undefined,
                        httpsAgent: useTorAgent ? torAgent : undefined
                      });
                    };

                    let playlistRes;
                    try {
                      playlistRes = await fetchPlaylist(false);
                    } catch (fetchErr) {
                      // If it's a mirror we usually use Tor for, try Tor failover
                      console.warn(`[getInfo] Direct check failed for ${id}, trying Tor failover...`);
                      playlistRes = await fetchPlaylist(true);
                    }

                    if (playlistRes && playlistRes.data) {
                      let playlist: any[] = [];
                      if (Array.isArray(playlistRes.data)) {
                        playlist = playlistRes.data;
                      } else if (playlistRes.data && typeof playlistRes.data === 'object' && playlistRes.data.list) {
                        playlist = playlistRes.data.list;
                      } else if (typeof playlistRes.data === 'string' && (playlistRes.data.includes('#EXTM3U') || playlistRes.data.includes('playlist') || playlistRes.data.includes('m3u8'))) {
                        playlist = [{ file: playlistUrl, label: "Auto", type: "hls" }];
                      }

                      playlist = playlist.filter((item: any) => item && (item.file || item.folder || item.src));

                      if (playlist.length > 0 && !resolvedData) {
                        console.log(`[getInfo] SUCCESS: Validated ${playlist.length} tracks at ${targetUrl}`);
                        resolvedData = { success: true, data: { playlist, key } };
                        return;
                      }
                    }
                  } catch (e: any) {
                    console.warn(`[getInfo] Validation failed for ${id}: ${e.message}`);

                    // CRITICAL FALLBACK for obfuscated paths (like those starting with ~ or with complex tokens)
                    const looksLikePlaylist = playlistUrl.includes('.m3u8') ||
                      playlistUrl.includes('.txt') ||
                      playlistUrl.includes('playlist') ||
                      playlistUrl.includes('/~');

                    if (!resolvedData && looksLikePlaylist) {
                      console.log(`[getInfo] Mirror ${domain} has content but blocked validation. Using direct fallback.`);
                      resolvedData = { success: true, data: { playlist: [{ file: playlistUrl, label: "Stream (Fixed)", type: "hls" }], key } };
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
