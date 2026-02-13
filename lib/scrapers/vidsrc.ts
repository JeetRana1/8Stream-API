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
        const baseDom = iframeSrc.startsWith("//") ? "https:" + iframeSrc : iframeSrc;
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

        if (servers.length === 0) {
            // Fallback: try to see if it's a direct iframe without server list
            if (iframeSrc) {
                return {
                    success: true,
                    streamUrl: baseDom,
                    isEmbed: true
                };
            }
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
                    const decryptRegex = /{}\}window\[([^"]+)\("([^"]+)"\)/;
                    const match = jsCode.match(decryptRegex);

                    if (match) {
                        const funcName = match[1].replace(/['"]/g, '').trim();
                        const key = match[2].trim();

                        const $$ = cheerio.load(prorcpHtml);
                        const id = decrypt(key, funcName);
                        if (!id) continue;

                        const divData = $$(`#${id}`).text();
                        const result = decrypt(divData, key);

                        if (result) {
                            return {
                                success: true,
                                streamUrl: result,
                                name: server.name
                            };
                        }
                    }
                } else if (path.startsWith("http")) {
                    return {
                        success: true,
                        streamUrl: path,
                        name: server.name
                    };
                }
            } catch (err: any) {
                console.error(`[scrapeVidsrc] Error with server ${server.name} on domain ${baseUrl}: ${err.message}`);
            }
        }

        // Final fallback: if no streams found but we have an iframe, return the iframe as an embed
        if (iframeSrc) {
            return {
                success: true,
                streamUrl: baseDom,
                isEmbed: true
            };
        }

        return { success: false, message: "Failed to extract from any server" };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}
