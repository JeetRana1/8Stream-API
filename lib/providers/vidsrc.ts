import axios from "axios";
import * as cheerio from "cheerio";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function getVidSrcStream(id: string) {
    try {
        const cleanId = id.replace('tt', '');
        const isImdb = id.startsWith('tt');

        // Prime domains for VidSrc
        const domains = [
            'https://vidsrc.to',
            'https://vidsrc.me',
            'https://vidsrc.cc',
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

                const fetchWithFallback = async (url: string, referer: string) => {
                    const headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        "Referer": referer,
                        "Accept": "*/*",
                        "Cache-Control": "no-cache"
                    };
                    try {
                        const res = await axios.get(url, { headers, timeout: 10000 });
                        if (res.status === 404) throw new Error("404");
                        return res;
                    } catch (err: any) {
                        const status = err.response?.status;
                        if (status === 403 || status === 429 || !err.response || err.message === '404') {
                            if (err.message === '404' && !url.includes('rcp')) {
                                // Don't Tor fallback 404s for main domains usually, but VidSrc is weird
                                console.log(`[VidSrc] 404 on ${url}, skipping or trying mirror`);
                                throw err;
                            }
                            console.log(`[VidSrc] Direct failed/blocked (${status || err.message}), trying Tor for ${url}`);
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

                // Collect all potential player/iframe URLs
                const candidateUrls: string[] = [];
                $('iframe').each((_, el) => {
                    const src = $(el).attr('data-src') || $(el).attr('src');
                    if (src) candidateUrls.push(src);
                });

                // Also look for window.location or similar in scripts
                const scriptText = $('script').text();
                const urlInScript = scriptText.match(/https?:\/\/[^\s"'<>]+/g) || [];
                urlInScript.forEach(u => {
                    if (u.includes('embed') || u.includes('player') || u.includes('rcp')) {
                        candidateUrls.push(u);
                    }
                });

                // Unique and normalized URLs
                const uniqueUrls = Array.from(new Set(candidateUrls.map(u => {
                    if (u.startsWith('//')) return 'https:' + u;
                    if (!u.startsWith('http')) return domain + (u.startsWith('/') ? u : '/' + u);
                    return u;
                })));

                for (const innerUrl of uniqueUrls) {
                    console.log(`[VidSrc] Analyzing candidate: ${innerUrl}`);
                    try {
                        const innerRes = await fetchWithFallback(innerUrl, embedUrl);
                        const body = typeof innerRes.data === 'string' ? innerRes.data : JSON.stringify(innerRes.data);

                        // DEEP SCAN STRATEGY

                        // 1. Look for direct .m3u8 URLs (even in complex strings)
                        const m3u8Regex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*\??[^\s"'<>]*/gi;
                        const m3u8Matches = body.match(m3u8Regex) || [];
                        for (const m of m3u8Matches) {
                            console.log(`[VidSrc] FOUND DIRECT HLS: ${m}`);
                            return {
                                success: true,
                                data: {
                                    playlist: [{ title: "VidSrc High", file: m, folder: [] }],
                                    key: "vidsrc_direct",
                                    provider: "vidsrc"
                                }
                            };
                        }

                        // 2. Look for Base64 encoded URLs (very common in cloudnestra/vidsrc)
                        // This regex looks for base64 blocks that might contain URLs
                        const b64Pattern = /["']([A-Za-z0-9+/=]{100,})["']/g;
                        let b64Match;
                        while ((b64Match = b64Pattern.exec(body)) !== null) {
                            try {
                                const decoded = Buffer.from(b64Match[1], 'base64').toString('utf8');
                                const subMatches = decoded.match(m3u8Regex) || decoded.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi) || [];
                                for (const sm of subMatches) {
                                    console.log(`[VidSrc] FOUND B64 DECODED URL: ${sm}`);
                                    return {
                                        success: true,
                                        data: {
                                            playlist: [{ title: "VidSrc B64", file: sm, folder: [] }],
                                            key: "vidsrc_direct",
                                            provider: "vidsrc"
                                        }
                                    };
                                }
                            } catch { }
                        }

                        // 3. Look for "file" or "sources" in JSON-like structures
                        const jsonSearch = /file\s*:\s*["']([^"']+)["']/gi;
                        let jMatch;
                        while ((jMatch = jsonSearch.exec(body)) !== null) {
                            let fUrl = jMatch[1];
                            if (fUrl.includes('.m3u8') || fUrl.includes('.mp4')) {
                                if (fUrl.startsWith('//')) fUrl = 'https:' + fUrl;
                                console.log(`[VidSrc] FOUND JSON FILE: ${fUrl}`);
                                return {
                                    success: true,
                                    data: {
                                        playlist: [{ title: "VidSrc JSON", file: fUrl, folder: [] }],
                                        key: "vidsrc_direct",
                                        provider: "vidsrc"
                                    }
                                };
                            }
                        }

                        // 4. Look for ajax endpoints that might return the source
                        const ajaxSearch = /\/ajax\/(?:embed|v2)\/source\/[A-Za-z0-9]+/i;
                        const aj = body.match(ajaxSearch);
                        if (aj) {
                            const baseUrl = innerUrl.split('/').slice(0, 3).join('/');
                            const ajaxUrl = baseUrl + aj[0];
                            console.log(`[VidSrc] Requesting AJAX source: ${ajaxUrl}`);
                            try {
                                const ajRes = await fetchWithFallback(ajaxUrl, innerUrl);
                                if (ajRes.data && ajRes.data.url) {
                                    return {
                                        success: true,
                                        data: {
                                            playlist: [{ title: "VidSrc AJAX", file: ajRes.data.url, folder: [] }],
                                            key: "vidsrc_direct",
                                            provider: "vidsrc"
                                        }
                                    };
                                }
                            } catch { }
                        }

                    } catch (e: any) {
                        console.log(`[VidSrc] Failed analyzing ${innerUrl}: ${e.message}`);
                    }
                }

            } catch (e: any) {
                console.log(`[VidSrc] Failed domain ${domain}: ${e.message}`);
            }
        }

        return { success: false, message: "VidSrc: No streams found after exhaustive scan" };
    } catch (error: any) {
        console.error(`[VidSrc] Critical Error:`, error.message);
        return { success: false, message: `VidSrc Error: ${error.message}` };
    }
}
