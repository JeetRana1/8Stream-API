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
            'https://vidsrc.icu'
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
                        "Accept-Language": "en-US,en;q=0.9",
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
                                timeout: 15000
                            });
                        }
                        throw err;
                    }
                };

                const response = await fetchWithFallback(embedUrl, domain);
                const $ = cheerio.load(response.data);

                // VidSrc typically has iframe with data-src or src
                const iframe = $('iframe[data-src], iframe[src]').first();
                let streamUrl = iframe.attr('data-src') || iframe.attr('src');

                if (streamUrl) {
                    console.log(`[VidSrc] Found embed URL: ${streamUrl}`);

                    // Normalize the URL
                    if (streamUrl.startsWith('//')) {
                        streamUrl = `https:${streamUrl}`;
                    } else if (!streamUrl.startsWith('http')) {
                        streamUrl = `${domain}${streamUrl.startsWith('/') ? streamUrl : '/' + streamUrl}`;
                    }

                    // Now fetch the actual stream from the embed
                    try {
                        const embedResponse = await fetchWithFallback(streamUrl, embedUrl);
                        const embed$ = cheerio.load(embedResponse.data);

                        // Look for HLS manifest URL in the embed page
                        const scriptTags = embed$('script').toArray();
                        for (const script of scriptTags) {
                            const scriptContent = embed$(script).html() || '';

                            // Look for m3u8 URLs in the script
                            const m3u8Match = scriptContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
                            if (m3u8Match) {
                                console.log(`[VidSrc] Found HLS URL: ${m3u8Match[0]}`);
                                return {
                                    success: true,
                                    data: {
                                        playlist: [{
                                            title: "VidSrc Stream",
                                            file: m3u8Match[0],
                                            folder: []
                                        }],
                                        key: "vidsrc_direct",
                                        provider: "vidsrc"
                                    }
                                };
                            }

                            // Look for source URLs in various formats
                            const sourceMatch = scriptContent.match(/["']?(?:source|file|src)["']?\s*:\s*["']([^"']+)["']/);
                            if (sourceMatch && sourceMatch[1] && (sourceMatch[1].includes('m3u8') || sourceMatch[1].includes('.mp4'))) {
                                console.log(`[VidSrc] Found source URL: ${sourceMatch[1]}`);
                                return {
                                    success: true,
                                    data: {
                                        playlist: [{
                                            title: "VidSrc Stream",
                                            file: sourceMatch[1].startsWith('//') ? `https:${sourceMatch[1]}` : sourceMatch[1],
                                            folder: []
                                        }],
                                        key: "vidsrc_direct",
                                        provider: "vidsrc"
                                    }
                                };
                            }
                        }

                        // If we can't extract the HLS URL, return the embed URL itself
                        // But only if it's not the same as the original embed URL to avoid loops
                        console.log(`[VidSrc] Could not extract HLS, returning embed URL as fallback`);
                        return {
                            success: true,
                            data: {
                                playlist: [{
                                    title: "VidSrc Stream (Fallback)",
                                    file: streamUrl,
                                    folder: []
                                }],
                                key: "vidsrc_embed",
                                provider: "vidsrc"
                            }
                        };
                    } catch (embedError: any) {
                        console.log(`[VidSrc] Failed to fetch embed: ${embedError.message}`);
                        return {
                            success: true,
                            data: {
                                playlist: [{
                                    title: "VidSrc Stream (Embed)",
                                    file: streamUrl,
                                    folder: []
                                }],
                                key: "vidsrc_embed",
                                provider: "vidsrc"
                            }
                        };
                    }
                }
            } catch (e: any) {
                console.log(`[VidSrc] Failed ${domain}: ${e.message}`);
            }
        }

        return { success: false, message: "VidSrc: No streams found" };
    } catch (error: any) {
        console.error(`[VidSrc] Error:`, error.message);
        return { success: false, message: `VidSrc Error: ${error.message}` };
    }
}
