import axios from "axios";
import * as cheerio from "cheerio";
import { getPlayerUrl } from "./getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getInfo(id: string) {
  try {
    const playerUrl = await getPlayerUrl();
    const paths = [`/play/${id}`, `/v/${id}`, `/watch/${id}`];

    let lastError: any = null;

    for (const path of paths) {
      const targetUrl = `${playerUrl.replace(/\/$/, '')}${path}`;
      console.log(`[getInfo] Trying path: ${targetUrl}`);

<<<<<<< HEAD
      const referers = ["https://allmovieland.link/", "https://google.com/"];

      for (const referer of referers) {
        try {
          const requestConfig = {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Referer": referer,
              "Origin": referer.replace(/\/$/, ''),
              "Cache-Control": "max-age=0"
            },
            timeout: 8000
          };

          let response;
          try {
            response = await axios.get(targetUrl, requestConfig);
          } catch {
            response = await axios.get(targetUrl, {
              ...requestConfig,
              httpAgent: torAgent,
              httpsAgent: torAgent,
              timeout: 12000
            });
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

            const link = file.startsWith("http") ? file : `${playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl}${file}`;

            const playlistConfig = {
=======
      // Try with Tor first, then Direct
      const modes = [
        { name: 'Tor', agent: torAgent },
        { name: 'Direct', agent: undefined }
      ];

      const referers = ["https://allmovieland.link/", "https://google.com/"];

      for (const mode of modes) {
        for (const referer of referers) {
          try {
            console.log(`[getInfo] Attempting ${mode.name} fetch from ${targetUrl} (Ref: ${referer})`);
            const response = await axios.get(targetUrl, {
>>>>>>> 4b1fb64253e6d9d93dfed6a87f75e1e232681780
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": referer,
                "Origin": referer.replace(/\/$/, ''),
                "Cache-Control": "max-age=0"
              },
<<<<<<< HEAD
              timeout: 8000
            };

            let playlistRes;
            try {
              playlistRes = await axios.get(link, playlistConfig);
            } catch {
              playlistRes = await axios.get(link, {
                ...playlistConfig,
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 12000
              });
            }
=======
              httpAgent: mode.agent,
              httpsAgent: mode.agent,
              timeout: 10000,
              validateStatus: (status) => status < 500 // Accept 404 to check if it's the server responding
            });
>>>>>>> 4b1fb64253e6d9d93dfed6a87f75e1e232681780

            if (response.status === 200) {
              const $ = cheerio.load(response.data);

              // Find the script with player data
              let data: any = null;
              $("script").each((i, el) => {
                const html = $(el).html();
                if (html && (html.includes('var p3 =') || html.includes('player = new') || html.includes('file:'))) {
                  const match = html.match(/var\s+p3\s*=\s*({[\s\S]*?});/) ||
                    html.match(/(\{[^;]*"file"[^;]*\});/) ||
                    html.match(/\((\{.*\})\)/);
                  if (match && match[1]) {
                    try {
                      data = JSON.parse(match[1]);
                    } catch (e) { }
                  }
                }
              });

              if (!data) {
                // Fallback for different templates
                const script = $("script").last().html();
                if (script) {
                  const contentMatch = script.match(/(\{[^;]+});/) || script.match(/\((\{.*\})\)/);
                  if (contentMatch && contentMatch[1]) {
                    try { data = JSON.parse(contentMatch[1]); } catch (e) { }
                  }
                }
              }

              if (!data || !data.file) continue;

              const file = data["file"];
              const key = data["key"];
              const link = file.startsWith("http") ? file : `${playerUrl.endsWith('/') ? playerUrl.slice(0, -1) : playerUrl}${file}`;

              console.log(`[getInfo] Found file at ${link} via ${mode.name}`);

              // Fetch playlist (reuse the working mode)
              const playlistRes = await axios.get(link, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                  "Accept": "*/*",
                  "Referer": targetUrl,
                  "X-Csrf-Token": key
                },
                httpAgent: mode.agent,
                httpsAgent: mode.agent,
                timeout: 10000
              });

              const playlist = Array.isArray(playlistRes.data)
                ? playlistRes.data.filter((item: any) => item && (item.file || item.folder))
                : [];

              if (playlist.length > 0) {
                return {
                  success: true,
                  data: {
                    playlist,
                    key,
                  },
                };
              }
            } else {
              console.log(`[getInfo] ${mode.name} failed with status ${response.status}`);
            }
          } catch (e: any) {
            console.log(`[getInfo] Failed path ${targetUrl} with ${mode.name} / ${referer}: ${e.message}`);
            lastError = e;
          }
        }

        // If we found a valid page but failed parsing, maybe don't switch mode? 
        // But if we failed connection, we continue to next mode.
      }
    }

    return {
      success: false,
      message: lastError ? `API Error: ${lastError.message}` : "Media not found on any known paths"
    };
  } catch (error: any) {
    console.error(`Error in getInfo:`, error.message);
    return {
      success: false,
      message: `API Error: ${error.message}`,
    };
  }
}
