import axios from "axios";
import * as cheerio from "cheerio";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function getVidSrcStream(id: string) {
    try {
        // VidSrc supports both IMDB IDs (tt...) and TMDB IDs
        const cleanId = id.replace('tt', '');
        const isImdb = id.startsWith('tt');

        // VidSrc has multiple domains
        const domains = [
            'https://vidsrc.to',
            'https://vidsrc.me',
            'https://vidsrc.net',
            'https://vidsrc.xyz',
            'https://vidsrc.pm'
        ];

        for (const domain of domains) {
            try {
                const embedUrl = isImdb
                    ? `${domain}/embed/movie/${id}`
                    : `${domain}/embed/movie/tmdb/${cleanId}`;

                console.log(`[VidSrc] Trying: ${embedUrl}`);

                // Helper to fetch with direct or tor fallback
                const fetchWithFallback = async (url: string, referer: string) => {
                    const headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        "Referer": referer,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    };
                    try {
                        return await axios.get(url, { headers, timeout: 8000 });
                    } catch (err: any) {
                        const status = err.response?.status;
                        if (status === 403 || status === 429 || !err.response) {
                            console.log(`[VidSrc] Direct failed (${status || 'timeout'}), trying Tor for ${url}`);
                            return await axios.get(url, {
                                headers,
                                httpAgent: torAgent,
                                httpsAgent: torAgent,
                                timeout: 25000
                            });
                        }
                        throw err;
                    }
                };

                const response = await fetchWithFallback(embedUrl, domain);
                const $ = cheerio.load(response.data);

                // VidSrc typically has iframe with data-src or src
                const iframe = $('iframe[data-src], iframe[src]').first();
                let innerUrl = iframe.attr('data-src') || iframe.attr('src');

                if (innerUrl) {
                    // Normalize innerUrl
                    if (innerUrl.startsWith('//')) {
                        innerUrl = `https:${innerUrl}`;
                    } else if (!innerUrl.startsWith('http')) {
                        innerUrl = `${domain}${innerUrl.startsWith('/') ? innerUrl : '/' + innerUrl}`;
                    }

                    console.log(`[VidSrc] Found inner URL: ${innerUrl}`);

                    // Fetch the inner page (this is usually where the player is)
                    const innerResponse = await fetchWithFallback(innerUrl, embedUrl);
                    const innerDoc = innerResponse.data;
                    const inner$ = cheerio.load(innerDoc);

                    // SEARCH STRATEGY 1: Direct Regex in all scripts
                    const scripts = inner$('script').toArray();
                    for (const scriptSection of scripts) {
                        const content = inner$(scriptSection).html() || '';

                        // Look for common file/source/m3u8 patterns
                        // Check for common obfuscated links (some start with base64)
                        const patterns = [
                            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"']*/i,
                            /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                            /src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                            /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                            /url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i
                        ];

                        for (const pattern of patterns) {
                            const match = content.match(pattern);
                            if (match) {
                                let foundUrl = match[1] || match[0];
                                if (foundUrl.startsWith('//')) foundUrl = 'https:' + foundUrl;

                                console.log(`[VidSrc] Found HLS URL via Regex: ${foundUrl}`);
                                return {
                                    success: true,
                                    data: {
                                        playlist: [{ title: "VidSrc High", file: foundUrl, folder: [] }],
                                        key: "vidsrc_direct",
                                        provider: "vidsrc"
                                    }
                                };
                            }
                        }
                    }

                    // SEARCH STRATEGY 2: Look for Base64 encoded strings that look like URLs
                    const b64Regex = /["']([A-Za-z0-9+/=]{40,})["']/g;
                    let b64Match;
                    while ((b64Match = b64Regex.exec(innerDoc)) !== null) {
                        try {
                            const decoded = Buffer.from(b64Match[1], 'base64').toString();
                            if (decoded.includes('.m3u8') || decoded.includes('.mp4') || decoded.includes('https://')) {
                                const urlMatch = decoded.match(/https?:\/\/[^\s"']+/);
                                if (urlMatch) {
                                    console.log(`[VidSrc] Found HLS URL via Base64: ${urlMatch[0]}`);
                                    return {
                                        success: true,
                                        data: {
                                            playlist: [{ title: "VidSrc B64", file: urlMatch[0], folder: [] }],
                                            key: "vidsrc_direct",
                                            provider: "vidsrc"
                                        }
                                    };
                                }
                            }
                        } catch { }
                    }

                    // SEARCH STRATEGY 3: Check for JWPlayer/VideoJS sources
                    const sourceTags = inner$('source[src]').toArray();
                    for (const s of sourceTags) {
                        const sUrl = inner$(s).attr('src');
                        if (sUrl && (sUrl.includes('.m3u8') || sUrl.includes('.mp4'))) {
                            console.log(`[VidSrc] Found HLS URL via Source Tag: ${sUrl}`);
                            return {
                                success: true,
                                data: {
                                    playlist: [{ title: "VidSrc Source", file: sUrl, folder: [] }],
                                    key: "vidsrc_direct",
                                    provider: "vidsrc"
                                }
                            };
                        }
                    }

                    // FALLBACK: Return the inner URL if no stream found
                    console.log(`[VidSrc] Could not extract stream block, returning inner URL as fallback`);
                    return {
                        success: true,
                        data: {
                            playlist: [{ title: "VidSrc Link", file: innerUrl, folder: [] }],
                            key: "vidsrc_embed",
                            provider: "vidsrc"
                        }
                    };
                }
            } catch (e: any) {
                console.log(`[VidSrc] Error on ${domain}: ${e.message}`);
            }
        }

        return { success: false, message: "VidSrc: Streams not found after searching all mirrors" };
    } catch (error: any) {
        console.error(`[VidSrc] Critical Error:`, error.message);
        return { success: false, message: `VidSrc Error: ${error.message}` };
    }
}
