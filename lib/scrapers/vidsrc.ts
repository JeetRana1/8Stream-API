import axios from "axios";
import * as cheerio from "cheerio";
import { decrypt } from "./decoders";

export async function scrapeVidsrc(tmdbId: string, type: "movie" | "tv", season?: number, episode?: number, baseUrl: string = "https://vidsrc.net") {
    try {
        const idParam = tmdbId.startsWith("tt") ? "imdb" : "tmdb";
        const embedUrl = type === "movie"
            ? `${baseUrl}/embed/movie?${idParam}=${tmdbId}`
            : `${baseUrl}/embed/tv?${idParam}=${tmdbId}&season=${season}&episode=${episode}`;

        console.log(`[scrapeVidsrc] Fetching embed: ${embedUrl} (Base: ${baseUrl})`);
        const res = await axios.get(embedUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": "https://google.com"
            },
            timeout: 10000
        });

        const $ = cheerio.load(res.data);
        const servers: { name: string; dataHash: string }[] = [];

        // Find the iframe to get the source domain (BASEDOM)
        const iframeSrc = $("iframe").attr("src") || "";
        let baseDom = iframeSrc.startsWith("//") ? "https:" + iframeSrc : iframeSrc;

        // Blacklist check - skip known problematic domains
        const blacklistedDomains = [
            "cloudnestra.com",
            "protection-episode-i-222.site",
            "malocacomals.com"
        ];

        // Exception: vidsrc.net and mirrors often use cloudnestra
        const allowCloudnestra = baseUrl.includes("vidsrc.net") || baseUrl.includes("vidsrc-embed.ru") || baseUrl.includes("vidsrc-embed.su") || baseUrl.includes("vsrc.su");

        const isBlacklisted = blacklistedDomains.some(domain => {
            if (allowCloudnestra && domain === "cloudnestra.com") return false;
            return baseDom.includes(domain);
        });

        if (isBlacklisted) {
            console.log(`[scrapeVidsrc] Base domain ${baseDom} is blacklisted. Skipping ${baseUrl}`);
            return { success: false, message: `Source ${baseUrl} returned blacklisted domain` };
        }

        let origin = "";
        try {
            origin = baseDom ? new URL(baseDom).origin : "";
        } catch (e) {
            origin = baseUrl;
        }

        $(".serversList .server").each((_, el) => {
            const server = $(el);
            const hash = server.attr("data-hash");
            if (hash) {
                servers.push({
                    name: server.text().trim(),
                    dataHash: hash,
                });
            }
        });

        // Fallback: If no servers found via selector, try generic regex for data-hash
        if (servers.length === 0) {
            console.log(`[scrapeVidsrc] No servers found via selector. Trying regex fallback...`);
            const hashRegex = /data-hash="([^"]+)"/g;
            let match;
            while ((match = hashRegex.exec(res.data)) !== null) {
                // Try to find the name near the hash or just default to "Server"
                // This is a rough fallback
                const hash = match[1];
                // Check if we already have this hash (avoid dupes)
                if (!servers.find(s => s.dataHash === hash)) {
                    servers.push({
                        name: "VidSrc Server", // Generic name
                        dataHash: hash
                    });
                }
            }
        }

        console.log(`[scrapeVidsrc] Found ${servers.length} servers on ${baseUrl}`);

        if (servers.length === 0) {
            console.log(`[scrapeVidsrc] HTML length: ${res.data.length}`);
            // Log a snippet to help debug
            console.log(`[scrapeVidsrc] HTML snippet: ${res.data.substring(0, 200)}...${res.data.substring(res.data.length - 200)}`);
            return { success: false, message: "No servers found" };
        }

        // Try each server
        for (const server of servers) {
            try {
                console.log(`[scrapeVidsrc] Trying server: ${server.name} on ${origin}`);
                const rcpUrl = `${origin}/rcp/${server.dataHash}`;
                const rcpRes = await axios.get(rcpUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        "Referer": embedUrl
                    },
                    timeout: 10000
                });

                const rcpHtml = rcpRes.data;
                const srcMatch = rcpHtml.match(/src:\s*'([^']*)'/);
                if (!srcMatch) continue;

                const path = srcMatch[1];
                if (path.startsWith("/prorcp/")) {
                    const prorcp = path.replace("/prorcp/", "");
                    const prorcpUrl = `${origin}/prorcp/${prorcp}`;
                    const prorcpRes = await axios.get(prorcpUrl, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                            "Referer": rcpUrl
                        },
                        timeout: 10000
                    });

                    const prorcpHtml = prorcpRes.data;
                    const scripts = prorcpHtml.match(/<script\s+src="\/([^"]*\.js)\?\_=([^"]*)"><\/script>/g);
                    if (!scripts) continue;

                    const scriptTag = scripts[scripts.length - 1];
                    const scriptSrcMatch = scriptTag.match(/src="\/([^"]*\.js)\?\_=([^"]*)"/);
                    if (!scriptSrcMatch) continue;

                    const jsUrl = `${origin}/${scriptSrcMatch[1]}?_=${scriptSrcMatch[2]}`;
                    const jsRes = await axios.get(jsUrl, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                            "Referer": prorcpUrl
                        },
                        timeout: 10000
                    });

                    const jsCode = jsRes.data;
                    console.log(`[scrapeVidsrc] Found JS on cloudnestra, checking for decryption...`);
                    const decryptRegex = /{}\}window\[([^"]+)\("([^"]+)"\)/;
                    const match = jsCode.match(decryptRegex);

                    if (match) {
                        const funcName = match[1].replace(/['"]/g, '').trim();
                        const key = match[2].trim();
                        console.log(`[scrapeVidsrc] Using decrypt function: ${funcName}`);

                        const $$ = cheerio.load(prorcpHtml);
                        const id = decrypt(key, funcName);
                        if (!id) {
                            console.log(`[scrapeVidsrc] Decrypt(key, func) failed to return an ID`);
                            continue;
                        }

                        const divData = $$(`#${id}`).text();
                        if (!divData) {
                            console.log(`[scrapeVidsrc] Could not find div #${id} in prorcp HTML`);
                            const allDivs: string[] = [];
                            $$('div').each((_, el) => {
                                const divId = $$(el).attr('id');
                                if (divId) allDivs.push(divId);
                            });
                            console.log(`[scrapeVidsrc] Available div IDs: ${allDivs.join(', ')}`);
                            continue;
                        }

                        const result = decrypt(divData, key);
                        console.log(`[scrapeVidsrc] Decrypted result (first 50 chars): ${result ? result.substring(0, 50) : 'null'}`);

                        if (result) {
                            const isStream = result.includes(".m3u8") || result.includes(".mp4");
                            return {
                                success: true,
                                streamUrl: result,
                                name: server.name,
                                isEmbed: !isStream
                            };
                        }
                    }
                } else if (path.startsWith("http")) {
                    const isStream = path.includes(".m3u8") || path.includes(".mp4");
                    return {
                        success: true,
                        streamUrl: path,
                        name: server.name,
                        isEmbed: !isStream
                    };
                }
            } catch (err: any) {
                console.error(`[scrapeVidsrc] Error with server ${server.name} on domain ${baseUrl}: ${err.message}`);
            }
        }

        // Final fallback: If extraction failed but the embed exists, return the embed URL itself
        console.log(`[scrapeVidsrc] All extractions failed for ${baseUrl}, returning base embed URL as fallback`);
        return {
            success: true,
            streamUrl: embedUrl,
            name: baseUrl.includes("vidsrc-embed") ? "VidSrcMe" : "VidSrc",
            isEmbed: true
        };
    } catch (error: any) {
        console.error(`[scrapeVidsrc] Failed to scrape ${baseUrl}: ${error.message}`, error.response ? error.response.status : '');
        return { success: false, message: error.message };
    }
}
