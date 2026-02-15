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

    const paths = [
      `/play/${id}`,
      `/play/${id}?tr=1`,
      `/play/${id}?tr=2`,
      `/v/${id}`,
      `/watch/${id}`
    ];

    const refererCandidates = [
      "https://allmovieland.link/",
      "https://google.com/"
    ];

    let resultData: any = null;

    console.log(`[getInfo] Starting parallel resolution for ID: ${id} across ${playerUrlCandidates.length} domains...`);

    // Process domains in parallel for speed
    await Promise.all(playerUrlCandidates.map(async (playerUrl) => {
      if (resultData) return;

      const domain = playerUrl.replace(/\/$/, '');
      const perDomainReferers = Array.from(new Set([
        `${domain}/`,
        ...refererCandidates
      ]));

      // Try all paths for this domain
      for (const path of paths) {
        if (resultData) return;
        const targetUrl = `${domain}${path}`;

        // Try referers
        for (const referer of perDomainReferers) {
          if (resultData) return;

          try {
            const headers = {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Referer": referer,
              "Origin": referer.replace(/\/$/, ''),
              "Cache-Control": "no-cache"
            };

            const useTor = shouldPreferTor(targetUrl) || hostNeedsTor.has(new URL(targetUrl).hostname);

            let response: any;
            if (useTor) {
              response = await axios.get(targetUrl, { headers, httpAgent: torAgent, httpsAgent: torAgent, timeout: 12000 });
            } else {
              try {
                response = await axios.get(targetUrl, { headers, timeout: 5000 });
              } catch (e: any) {
                // Failover to Tor on timeout or block
                if (e.code === 'ECONNABORTED' || e.response?.status === 403 || e.response?.status === 401) {
                  hostNeedsTor.set(new URL(targetUrl).hostname, { timestamp: Date.now() });
                  response = await axios.get(targetUrl, { headers, httpAgent: torAgent, httpsAgent: torAgent, timeout: 12000 });
                } else throw e;
              }
            }

            if (response.status === 200) {
              const $ = cheerio.load(response.data);
              const script = $("script").last().html();
              if (!script) continue;

              const contentMatch = script.match(/(\{[^;]+});/) || script.match(/\((\{.*\})\)/);
              if (!contentMatch || !contentMatch[1]) continue;

              const data = JSON.parse(contentMatch[1]);
              const file = data["file"];
              const key = data["key"];
              if (!file) continue;

              console.log(`[getInfo] Found data on ${targetUrl}, file: ${file.substring(0, 30)}...`);

              const link = file.startsWith("http") ? file : `${domain}${file}`;

              const playlistConfig = {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                  "Accept": "*/*",
                  "Referer": targetUrl,
                  "X-Csrf-Token": key
                },
                timeout: 8000
              };

              let playlistRes: any;
              try {
                playlistRes = await axios.get(link, playlistConfig);
              } catch {
                playlistRes = await axios.get(link, { ...playlistConfig, httpAgent: torAgent, httpsAgent: torAgent, timeout: 12000 });
              }

              const playlist = Array.isArray(playlistRes.data)
                ? playlistRes.data.filter((item: any) => item && (item.file || item.folder))
                : [];

              if (playlist.length > 0) {
                console.log(`[getInfo] RESOLVED: ${id} via ${targetUrl}`);
                resultData = { success: true, data: { playlist, key } };
                return;
              }
            }
          } catch (e: any) {
            // Silent fail for individual candidate paths
          }
        }
      }
    }));

    if (resultData) return resultData;

    console.log(`[getInfo] Resolution FAILED for ID: ${id}`);
    return {
      success: false,
      message: "Media not found or mirrors are currently inaccessible."
    };
  } catch (error: any) {
    console.error(`[getInfo] Critical Error:`, error.message);
    return {
      success: false,
      message: `API Error: ${error.message}`,
    };
  }
}
