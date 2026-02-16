import axios from "axios";
import * as cheerio from "cheerio";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function getVidSrcStream(id: string) {
    try {
        const cleanId = id.replace('tt', '');
        const isImdb = id.startsWith('tt');

        // Prime domains for VidSrc and its various mirrors/clones
        const domains = [
            'https://vidsrc.to',
            'https://vidsrc.me',
            'https://vidsrc.cc',
            'https://vidsrc.net',
            'https://vidsrc.xyz',
            'https://vidsrc.pm',
            'https://vidsrc.su',
            'https://vidsrc.in',
            'https://vidsrc.stream',
            'https://vidsrcme.ru'
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
                        const res = await axios.get(url, { headers, timeout: 12000 });
                        return res;
                    } catch (err: any) {
                        const status = err.response?.status;
                        // Always try Tor for 403, 429, or cloudflare blocks
                        if (status === 403 || status === 429 || !err.response || err.code === 'ECONNABORTED') {
                            console.log(`[VidSrc] Direct failed/blocked (${status || err.message}), trying Tor for ${url}`);
                            return await axios.get(url, {
                                headers,
                                httpAgent: torAgent,
                                httpsAgent: torAgent,
                                timeout: 30000
                            });
                        }
                        throw err;
                    }
                };

                const response = await fetchWithFallback(embedUrl, domain);
                const $ = cheerio.load(response.data);

                // Collect all potential player/iframe URLs
                const candidateUrls: string[] = [];
                $('iframe, embed, object').each((_, el) => {
                    const src = $(el).attr('data-src') || $(el).attr('src');
                    if (src) candidateUrls.push(src);
                });

                // Scan scripts for URLs
                const scriptText = $('script').text();
                const urlInScript = scriptText.match(/https?:\/\/[^\s"'<>]+/g) || [];
                urlInScript.forEach(u => {
                    if (u.includes('embed') || u.includes('player') || u.includes('rcp') || u.includes('source') || u.includes('cloudnestra')) {
                        candidateUrls.push(u);
                    }
                });

                const uniqueUrls = Array.from(new Set(candidateUrls.map(u => {
                    if (u.startsWith('//')) return 'https:' + u;
                    if (!u.startsWith('http')) return domain + (u.startsWith('/') ? u : '/' + u);
                    return u;
                })));

                for (const innerUrl of uniqueUrls) {
                    console.log(`[VidSrc] Looking for stream in: ${innerUrl}`);
                    try {
                        const innerRes = await fetchWithFallback(innerUrl, embedUrl);
                        const body = typeof innerRes.data === 'string' ? innerRes.data : JSON.stringify(innerRes.data);

                        // 1. Regex for common video extensions
                        const videoRegex = /https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mkv|webm|ts)[^\s"'<>]*\??[^\s"'<>]*/gi;
                        const videoMatches = body.match(videoRegex) || [];
                        for (const v of videoMatches) {
                            if (!v.includes('fonts.gstatic.com')) {
                                console.log(`[VidSrc] FOUND DIRECT VIDEO: ${v}`);
                                return {
                                    success: true,
                                    data: {
                                        playlist: [{ title: "VidSrc HD", file: v, folder: [] }],
                                        key: "vidsrc_direct",
                                        provider: "vidsrc"
                                    }
                                };
                            }
                        }

                        // 2. Base64 Decoder
                        const b64Search = /["']([A-Za-z0-9+/=]{60,})["']/g;
                        let b64Match;
                        while ((b64Match = b64Search.exec(body)) !== null) {
                            try {
                                const decoded = Buffer.from(b64Match[1], 'base64').toString('utf8');
                                const subMatches = decoded.match(videoRegex) || [];
                                for (const sm of subMatches) {
                                    console.log(`[VidSrc] FOUND B64 VIDEO: ${sm}`);
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

                        // 3. AJAX source endpoints (very common)
                        const ajaxSearch = /\/ajax\/(?:embed|v2|source)\/[A-Za-z0-9]+/gi;
                        const ajaxMatches = body.match(ajaxSearch) || [];
                        for (const ajPath of ajaxMatches) {
                            const baseUrl = innerUrl.split('/').slice(0, 3).join('/');
                            const ajaxUrl = baseUrl + ajPath;
                            console.log(`[VidSrc] Testing AJAX source: ${ajaxUrl}`);
                            try {
                                const ajRes = await fetchWithFallback(ajaxUrl, innerUrl);
                                const ajData = typeof ajRes.data === 'string' ? JSON.parse(ajRes.data) : ajRes.data;
                                if (ajData.url || ajData.file || ajData.source) {
                                    const rawUrl = ajData.url || ajData.file || ajData.source;
                                    console.log(`[VidSrc] FOUND FROM AJAX: ${rawUrl}`);
                                    return {
                                        success: true,
                                        data: {
                                            playlist: [{ title: "VidSrc Master", file: rawUrl, folder: [] }],
                                            key: "vidsrc_direct",
                                            provider: "vidsrc"
                                        }
                                    };
                                }
                            } catch { }
                        }

                    } catch (e: any) {
                        console.log(`[VidSrc] Inner scan failed: ${e.message}`);
                    }
                }
            } catch (e: any) {
                console.log(`[VidSrc] Domain ${domain} failed: ${e.message}`);
            }
        }

        return { success: false, message: "VidSrc: No streams found after full crawl" };
    } catch (error: any) {
        console.error(`[VidSrc] Crawler Error:`, error.message);
        return { success: false, message: `VidSrc Error: ${error.message}` };
    }
}
