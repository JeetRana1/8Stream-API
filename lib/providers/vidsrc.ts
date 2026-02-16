import axios from "axios";
import * as cheerio from "cheerio";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function getVidSrcStream(id: string) {
    try {
        const cleanId = id.replace('tt', '');
        const isImdb = id.startsWith('tt');

        // Extended domain list
        const domains = [
            'https://vidsrc.to',
            'https://vidsrc.me',
            'https://vidsrc.net',
            'https://vidsrc.in',
            'https://vidsrc.pm',
            'https://vidsrc.xyz'
        ];

        for (const domain of domains) {
            try {
                const embedUrl = isImdb
                    ? `${domain}/embed/movie/${id}`
                    : `${domain}/embed/movie/tmdb/${cleanId}`;

                console.log(`[VidSrc] Trying: ${embedUrl}`);

                const fetchWithFallback = async (url: string, referer: string) => {
                    const headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        "Referer": referer,
                        "Accept": "*/*",
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

                // Find the internal player URL (usually in an iframe)
                const iframes = $('iframe').toArray();
                let innerUrls: string[] = [];

                for (const iframe of iframes) {
                    const src = $(iframe).attr('data-src') || $(iframe).attr('src');
                    if (src) {
                        let normalized = src;
                        if (src.startsWith('//')) normalized = 'https:' + src;
                        else if (!src.startsWith('http')) normalized = domain + (src.startsWith('/') ? src : '/' + src);
                        innerUrls.push(normalized);
                    }
                }

                // If no iframes, check for scripts that might set window.location or similar
                if (innerUrls.length === 0) {
                    const scripts = $('script').toArray();
                    for (const s of scripts) {
                        const content = $(s).html() || '';
                        const match = content.match(/src\s*:\s*["']([^"']+)["']/);
                        if (match && (match[1].includes('embed') || match[1].includes('player'))) {
                            let normalized = match[1];
                            if (normalized.startsWith('//')) normalized = 'https:' + normalized;
                            innerUrls.push(normalized);
                        }
                    }
                }

                for (let innerUrl of innerUrls) {
                    console.log(`[VidSrc] Analyzing inner URL: ${innerUrl}`);

                    try {
                        const innerResponse = await fetchWithFallback(innerUrl, embedUrl);
                        const innerDoc = innerResponse.data;
                        const inner$ = cheerio.load(innerDoc);

                        // Look for the "real" stream URL in THIS page

                        // 1. Check for standard m3u8 regex
                        const manifestRegex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"']*/gi;
                        const allMatches = innerDoc.match(manifestRegex) || [];

                        for (const mUrl of allMatches) {
                            if (mUrl.includes('playlist.m3u8') || mUrl.includes('master.m3u8') || mUrl.includes('/index.m3u8')) {
                                console.log(`[VidSrc] Found Direct HLS: ${mUrl}`);
                                return {
                                    success: true,
                                    data: {
                                        playlist: [{ title: "VidSrc HD", file: mUrl, folder: [] }],
                                        key: "vidsrc_direct",
                                        provider: "vidsrc"
                                    }
                                };
                            }
                        }

                        // 2. Look for JSON structures (often used by JWPlayer or Clappr)
                        const jsonRegex = /\{[^{}]*?"file"\s*:\s*["']([^"']+\.m3u8[^"']*)["'][^{}]*?\}/gi;
                        let jsonMatch;
                        while ((jsonMatch = jsonRegex.exec(innerDoc)) !== null) {
                            let fUrl = jsonMatch[1];
                            if (fUrl.startsWith('//')) fUrl = 'https:' + fUrl;
                            console.log(`[VidSrc] Found HLS in JSON: ${fUrl}`);
                            return {
                                success: true,
                                data: {
                                    playlist: [{ title: "VidSrc JSON", file: fUrl, folder: [] }],
                                    key: "vidsrc_direct",
                                    provider: "vidsrc"
                                }
                            };
                        }

                        // 3. Look for the "RCP" or encoded data
                        // Often there's an ajax call like /ajax/embed/source?id=...
                        const ajaxMatch = innerDoc.match(/\/ajax\/embed\/[^"']+/);
                        if (ajaxMatch) {
                            const ajaxUrl = innerUrl.split('/').slice(0, 3).join('/') + ajaxMatch[0];
                            console.log(`[VidSrc] Found potential AJAX endpoint: ${ajaxUrl}`);
                            try {
                                const ajaxRes = await fetchWithFallback(ajaxUrl, innerUrl);
                                if (ajaxRes.data && ajaxRes.data.url) {
                                    console.log(`[VidSrc] AJAX success: ${ajaxRes.data.url}`);
                                    return {
                                        success: true,
                                        data: {
                                            playlist: [{ title: "VidSrc AJAX", file: ajaxRes.data.url, folder: [] }],
                                            key: "vidsrc_direct",
                                            provider: "vidsrc"
                                        }
                                    };
                                }
                            } catch { }
                        }

                        // 4. Base64 fallback (more robust)
                        const b64Regex = /["']([A-Za-z0-9+/=]{60,})["']/g;
                        let b64;
                        while ((b64 = b64Regex.exec(innerDoc)) !== null) {
                            try {
                                const decoded = Buffer.from(b64[1], 'base64').toString();
                                if (decoded.includes('.m3u8')) {
                                    const uMatch = decoded.match(/https?:\/\/[^\s"']+/);
                                    if (uMatch) {
                                        console.log(`[VidSrc] Decoded B64 HLS: ${uMatch[0]}`);
                                        return {
                                            success: true,
                                            data: {
                                                playlist: [{ title: "VidSrc B64", file: uMatch[0], folder: [] }],
                                                key: "vidsrc_direct",
                                                provider: "vidsrc"
                                            }
                                        };
                                    }
                                }
                            } catch { }
                        }
                    } catch (e: any) {
                        console.log(`[VidSrc] Error analyzing inner URL: ${e.message}`);
                    }
                }

                // Final check: Maybe the stream URL is right in the main page?
                const mainMatches = (response.data as string).match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"']*/gi) || [];
                for (const mUrl of mainMatches) {
                    if (mUrl.includes('.m3u8')) {
                        console.log(`[VidSrc] Found HLS on main page: ${mUrl}`);
                        return {
                            success: true,
                            data: {
                                playlist: [{ title: "VidSrc Main", file: mUrl, folder: [] }],
                                key: "vidsrc_direct",
                                provider: "vidsrc"
                            }
                        };
                    }
                }

            } catch (e: any) {
                console.log(`[VidSrc] Error on ${domain}: ${e.message}`);
            }
        }

        return { success: false, message: "VidSrc: No stream found after deep scan" };
    } catch (error: any) {
        console.error(`[VidSrc] Critical Error:`, error.message);
        return { success: false, message: `VidSrc Error: ${error.message}` };
    }
}
