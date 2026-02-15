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
            // If another task already won, abort immediately
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
                timeout: useTor ? 18000 : 6000,
                httpAgent: useTor ? torAgent : undefined,
                httpsAgent: useTor ? torAgent : undefined,
                validateStatus: (s: number) => s === 200
              };

              try {
                response = await axios.get(targetUrl, fetchOptions);
              } catch (err: any) {
                // Intelligent Tor Failover
                if (!useTor && (err.code === 'ECONNABORTED' || err.response?.status === 403 || err.response?.status === 429)) {
                  hostNeedsTor.set(new URL(targetUrl).hostname, { timestamp: Date.now() });
                  response = await axios.get(targetUrl, { ...fetchOptions, httpAgent: torAgent, httpsAgent: torAgent, timeout: 20000 });
                } else return; // Failure, just exit this task
              }

              if (!response || response.status !== 200) return;

              const html = String(response.data);
              if (!html.includes("file")) return;

              const $ = cheerio.load(html);
              const scripts = $("script").map((i, el) => $(el).html()).get();

              for (const script of scripts) {
                if (resolvedData) return;
                if (!script || !script.includes("file")) continue;

                // Extract file and key using multi-format regex
                const fileMatch = script.match(/["']?file["']?\s*:\s*["']([^"']+)["']/);
                const keyMatch = script.match(/["']?key["']?\s*:\s*["']([^"']+)["']/);

                if (fileMatch && fileMatch[1]) {
                  foundPotentialMetadata = true;
                  const file = fileMatch[1];
                  const key = keyMatch ? keyMatch[1] : "";
                  const playlistUrl = file.startsWith("http") ? file : `${domain}${file}`;

                  try {
                    // Attempt to validate the playlist (Race inside the race)
                    const playlistRes = await axios.get(playlistUrl, {
                      headers: {
                        "User-Agent": headers["User-Agent"],
                        "Referer": targetUrl,
                        "X-Csrf-Token": key || "0"
                      },
                      timeout: 8000
                    });

                    let playlist = Array.isArray(playlistRes.data) ? playlistRes.data : (playlistRes.data.list || []);
                    playlist = playlist.filter((item: any) => item && (item.file || item.folder));

                    if (playlist.length > 0 && !resolvedData) {
                      console.log(`[getInfo] WINNER: ${targetUrl} (Referer: ${referer})`);
                      resolvedData = { success: true, data: { playlist, key } };
                      return;
                    }
                  } catch (playlistErr) {
                    // Silent failover to Tor for the playlist itself as a last resort
                    try {
                      const torPlaylistRes = await axios.get(playlistUrl, {
                        headers: { "User-Agent": headers["User-Agent"], "Referer": targetUrl, "X-Csrf-Token": key },
                        httpAgent: torAgent, httpsAgent: torAgent, timeout: 15000
                      });
                      let playlist = Array.isArray(torPlaylistRes.data) ? torPlaylistRes.data : (torPlaylistRes.data.list || []);
                      playlist = playlist.filter((item: any) => item && (item.file || item.folder));
                      if (playlist.length > 0 && !resolvedData) {
                        resolvedData = { success: true, data: { playlist, key } };
                        return;
                      }
                    } catch { }
                  }
                }
              }
            } catch { }
          })());
        }
      }
    }

    // 3. Orchestrate the race: Wait until either someone wins or all tasks finish
    // We use a custom waiter because we want to stop as soon as resultData is set.
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Resolution Timeout")), 30000));

    await Promise.race([
      Promise.all(tasks),
      timeoutPromise
    ]).catch(() => {
      console.warn(`[getInfo] Race timed out for ${id}`);
    });

    if (resolvedData) return resolvedData;

    // If we found a file but no playlist, it's likely unreleased
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
