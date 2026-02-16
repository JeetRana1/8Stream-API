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
            'https://vidsrc.net'
        ];

        for (const domain of domains) {
            try {
                const embedUrl = isImdb
                    ? `${domain}/embed/movie/${id}`
                    : `${domain}/embed/movie/tmdb/${cleanId}`;

                console.log(`[VidSrc] Trying: ${embedUrl}`);

                const response = await axios.get(embedUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": domain,
                    },
                    timeout: 8000
                });

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
                        const embedResponse = await axios.get(streamUrl, {
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                                "Referer": embedUrl,
                            },
                            timeout: 10000
                        });

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
                                        key: "",
                                        provider: "vidsrc"
                                    }
                                };
                            }

                            // Look for source URLs in various formats
                            const sourceMatch = scriptContent.match(/["']?(?:source|file|src)["']?\s*:\s*["']([^"']+)["']/);
                            if (sourceMatch && sourceMatch[1] && sourceMatch[1].includes('m3u8')) {
                                console.log(`[VidSrc] Found source URL: ${sourceMatch[1]}`);
                                return {
                                    success: true,
                                    data: {
                                        playlist: [{
                                            title: "VidSrc Stream",
                                            file: sourceMatch[1],
                                            folder: []
                                        }],
                                        key: "",
                                        provider: "vidsrc"
                                    }
                                };
                            }
                        }

                        // If we can't extract the HLS URL, return the embed URL itself
                        // The proxy will handle it
                        console.log(`[VidSrc] Could not extract HLS, returning embed URL`);
                        return {
                            success: true,
                            data: {
                                playlist: [{
                                    title: "VidSrc Stream",
                                    file: streamUrl,
                                    folder: []
                                }],
                                key: "",
                                provider: "vidsrc"
                            }
                        };
                    } catch (embedError: any) {
                        console.log(`[VidSrc] Failed to fetch embed: ${embedError.message}`);
                        // Return the embed URL anyway
                        return {
                            success: true,
                            data: {
                                playlist: [{
                                    title: "VidSrc Stream",
                                    file: streamUrl,
                                    folder: []
                                }],
                                key: "",
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
