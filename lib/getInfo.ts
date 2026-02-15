import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl, getPlayerUrlWithOptions } from "./getPlayerUrl";
import { torAgent, shouldPreferTor, hostNeedsTor } from "./proxyAgents";

export default async function getInfo(id: string) {
  try {
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

    const playerUrlCandidates = Array.from(new Set(
      [primaryPlayerUrl, refreshedPlayerUrl, ...fallbackPlayerUrls]
        .map((u) => String(u || "").trim().replace(/\/$/, ""))
        .filter(Boolean)
    ));

    const paths = [`/play/${id}`, `/play/${id}?tr=1`, `/play/${id}?tr=2`, `/v/${id}`, `/watch/${id}`];
    const refererCandidates = ["https://allmovieland.link/", "https://google.com/"];

    let resultData: any = null;
    let foundAFile = false; // Flag to track if we at least found a metadata block

    console.log(`[getInfo] Resolving ${id} via ${playerUrlCandidates.length} domains...`);

    // Run domains in parallel
    await Promise.all(playerUrlCandidates.map(async (domain) => {
      if (resultData) return;

      const perDomainReferers = Array.from(new Set([`${domain}/`, ...refererCandidates]));

      for (const path of paths) {
        if (resultData) return;
        const targetUrl = `${domain}${path}`;

        for (const referer of perDomainReferers) {
          if (resultData) return;

          try {
            const headers = {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Referer": referer,
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
              "Cache-Control": "no-cache"
            };

            const useTor = shouldPreferTor(targetUrl) || hostNeedsTor.has(new URL(targetUrl).hostname);
            let response: any;

            try {
              response = await axios.get(targetUrl, {
                headers,
                timeout: useTor ? 15000 : 7000,
                httpAgent: useTor ? torAgent : undefined,
                httpsAgent: useTor ? torAgent : undefined
              });
            } catch (err: any) {
              // Failover to Tor on timeout or 403
              if (!useTor && (err.code === 'ECONNABORTED' || err.response?.status === 403)) {
                hostNeedsTor.set(new URL(targetUrl).hostname, { timestamp: Date.now() });
                response = await axios.get(targetUrl, { headers, httpAgent: torAgent, httpsAgent: torAgent, timeout: 20000 });
              } else throw err;
            }

            if (response.status === 200) {
              const html = String(response.data);
              const $ = cheerio.load(html);
              const scripts = $("script").map((i, el) => $(el).html()).get();

              for (const script of scripts) {
                if (!script || !script.includes("file")) continue;

                // Robust extraction: Look for anything resembling a playlist config object
                // This covers JSON, JS objects, and obfuscated formats
                const fileMatch = script.match(/["']?file["']?\s*:\s*["']([^"']+)["']/);
                const keyMatch = script.match(/["']?key["']?\s*:\s*["']([^"']+)["']/);

                if (fileMatch && fileMatch[1]) {
                  foundAFile = true;
                  const file = fileMatch[1];
                  const key = keyMatch ? keyMatch[1] : "";
                  const link = file.startsWith("http") ? file : `${domain}${file}`;

                  try {
                    const playlistRes = await axios.get(link, {
                      headers: { "User-Agent": headers["User-Agent"], "Referer": targetUrl, "X-Csrf-Token": key },
                      timeout: 10000
                    });

                    // Flexible playlist detection (direct array or list property)
                    let playlist = Array.isArray(playlistRes.data) ? playlistRes.data : (playlistRes.data.list || []);
                    playlist = playlist.filter((item: any) => item && (item.file || item.folder));

                    if (playlist.length > 0) {
                      console.log(`[getInfo] SUCCESS: Resolved ${id} via ${targetUrl}`);
                      resultData = { success: true, data: { playlist, key } };
                      return;
                    }
                  } catch (e) {
                    // Attempt playlist fetch via Tor if direct fails
                    try {
                      const torPlaylistRes = await axios.get(link, {
                        headers: { "User-Agent": headers["User-Agent"], "Referer": targetUrl, "X-Csrf-Token": key },
                        httpAgent: torAgent, httpsAgent: torAgent, timeout: 15000
                      });
                      let playlist = Array.isArray(torPlaylistRes.data) ? torPlaylistRes.data : (torPlaylistRes.data.list || []);
                      playlist = playlist.filter((item: any) => item && (item.file || item.folder));
                      if (playlist.length > 0) {
                        console.log(`[getInfo] SUCCESS (via Tor): Resolved ${id} via ${targetUrl}`);
                        resultData = { success: true, data: { playlist, key } };
                        return;
                      }
                    } catch { }
                  }
                }
              }
            }
          } catch (e: any) {
            // Silently continue for this path
          }
        }
      }
    }));

    if (resultData) return resultData;

    return {
      success: false,
      message: foundAFile
        ? "Stream found but playlist is empty (media might not be released yet)."
        : "Media not found or mirrors are currently inaccessible."
    };
  } catch (error: any) {
    return { success: false, message: `API Error: ${error.message}` };
  }
}
