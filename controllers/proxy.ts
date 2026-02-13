import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

/**
 * Proxy controller optimized for stability and reliability.
 * Reverted to pure-Tor for data integrity while keeping HLS rewriting.
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;
    const host = req.get('host') || "";
    const protocol = req.protocol;
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

    // 0. Safety Valve: Smart Passthrough for Fragile Audio Providers (via Tor)
    // If we detect lizer123 or similar audio hosts, we turn off all "smart" features and use Tor
    if (targetUrl && (targetUrl.includes('lizer123') || targetUrl.includes('getm3u8'))) {
        console.log(`[Proxy Raw] Tor Passthrough for fragile audio: ${targetUrl}`);
        try {
            const rawRes = await axios.get(targetUrl, {
                responseType: 'arraybuffer', // Fetch as buffer to inspect content
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                    "Accept": "*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "cross-site",
                    "Pragma": "no-cache",
                    "Cache-Control": "no-cache"
                },
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 20000,
                maxRedirects: 5,
                validateStatus: (status) => status < 400
            });

            // Handle Redirections properly
            const finalUrl = rawRes.request.res.responseUrl || targetUrl;
            const contentType = rawRes.headers['content-type'];

            // If it's a manifest, we MUST rewrite it to fix relative paths
            if (contentType && (contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL') || finalUrl.includes('.m3u8'))) {
                console.log(`[Proxy Raw] Detected Manifest in Passthrough. Rewriting from ${finalUrl}...`);
                let content = rawRes.data.toString('utf-8');
                const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
                // Self-reference as referer for segments
                const refParam = `&proxy_ref=${encodeURIComponent(finalUrl)}`;

                const rewrittenLines = content.split('\n').map((line: string) => {
                    const trimmed = line.trim();
                    if (!trimmed) return line;

                    if (trimmed.startsWith('#')) return line;

                    // Rewrite segment/playlist URL
                    const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}`;
                });

                res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.send(rewrittenLines.join('\n'));
            }

            // If binary/segment, send as is
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
            res.setHeader("Content-Type", contentType || 'application/vnd.apple.mpegurl');

            return res.status(200).send(rawRes.data);
        } catch (e: any) {
            console.log(`[Proxy Raw] Failed: ${e.message}`);
            return res.status(500).send("Audio Stream Error");
        }
    }

    // 1. Root Trap: Handle relative stream requests
    if (!targetUrl) {
        const fullPath = req.originalUrl;
        if (fullPath.includes('/stream/')) {
            const streamPart = fullPath.substring(fullPath.indexOf('/stream/') + 8);
            const [pathSegment, query] = streamPart.split('?');
            try {
                // Try decoding base64 if needed
                let path = pathSegment;
                try {
                    const decoded = Buffer.from(pathSegment, 'base64').toString('utf-8');
                    if (decoded.includes('/') || decoded.includes('.')) path = decoded;
                } catch (e) { }

                const playerUrl = await getPlayerUrl();
                const base = playerUrl.replace(/\/$/, '');
                targetUrl = path.startsWith('http') ? path : `${base}/stream/${path}`;
                if (query) targetUrl += `?${query}`;
            } catch (e) {
                const playerUrl = await getPlayerUrl();
                targetUrl = `${playerUrl.replace(/\/$/, '')}${fullPath}`;
            }
        }
    }

    let isSegment = false;

    if (!targetUrl) return res.status(400).send("Proxy Error: No URL");

    try {
        // 1. Extract the Referer Hint (passed from getStream or recursive HLS)
        const proxyRef = req.query.proxy_ref as string;

        // 2. Identify file types and generate smart headers
        const isM3U8 = targetUrl.includes('.m3u8') || targetUrl.includes('.txt') || targetUrl.includes('vixsrc.to/playlist/');
        isSegment = targetUrl.includes('.ts') || targetUrl.includes('.mp4');

        const getProxyHeaders = (url: string, altReferer?: string) => {
            const uri = new URL(url);
            let referer = altReferer || proxyRef || "https://allmovieland.link/";

            if (!proxyRef && !altReferer) {
                if (url.includes('slime') || url.includes('vekna')) {
                    referer = `https://${url.includes('slime') ? 'vekna402las.com' : uri.host}/`;
                } else if (url.includes('vidsrc')) {
                    referer = "https://vidsrc.me/";
                } else if (url.includes('vidlink')) {
                    referer = "https://vidlink.pro/";
                } else if (url.includes('vixsrc.to')) {
                    referer = "https://vixsrc.to/";
                } else if (url.includes('superembed')) {
                    referer = "https://superembed.stream/";
                } else {
                    referer = `https://${uri.host}/`;
                }
            } else if (!altReferer) {
                try {
                    const proxyHost = new URL(proxyRef).hostname;
                    if (!url.includes(proxyHost)) {
                        referer = url.includes('vixsrc.to') ? (proxyRef || "https://vixsrc.to/") : `https://${uri.host}/`;
                    } else {
                        referer = proxyRef;
                    }
                } catch (e) {
                    referer = url.includes('vixsrc.to') ? "https://vixsrc.to/" : `https://${uri.host}/`;
                }
            }

            // CLEAN UP REFERER: trailing slashes only for roots
            if (referer.startsWith('http') && !referer.includes('movie/') && !referer.includes('tv/') && !referer.includes('playlist/') && !referer.endsWith('/')) {
                referer += '/';
            }
            const origin = referer.split('/').slice(0, 3).join('/');

            // Minimalist headers for VixSrc (to match browser patterns)
            if (url.includes('vixsrc.to')) {
                return {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                    "Referer": referer,
                    "Accept": "application/x-mpegURL, application/vnd.apple.mpegurl, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Cache-Control": "no-cache"
                };
            }

            return {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": origin,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "keep-alive",
                "Sec-Fetch-Dest": isSegment ? "video" : "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "DNT": "1",
                "Pragma": "no-cache",
                "Cache-Control": "no-cache"
            };
        };

        const tryFetch = async (useTor: boolean, altReferer?: string) => {
            return await axios.get(targetUrl, {
                headers: getProxyHeaders(targetUrl, altReferer),
                httpAgent: useTor ? torAgent : undefined,
                httpsAgent: useTor ? torAgent : undefined,
                responseType: isM3U8 ? 'text' : 'stream',
                timeout: isSegment ? 20000 : 30000,
                maxRedirects: 5,
                validateStatus: () => true
            });
        };

        let response: any;
        try {
            if (isSegment || targetUrl.includes('vixsrc')) {
                try {
                    response = await tryFetch(false);
                    // Special VixSrc Logic: If 403, retry with Google referer (sometimes works better on cloud IPs)
                    if (response.status === 403 && targetUrl.includes('vixsrc')) {
                        console.log(`[Proxy Adaptive] VixSrc 403. Retrying with Google referer...`);
                        response = await tryFetch(false, "https://google.com");
                    }

                    if (response.status >= 400 && response.status !== 404) {
                        console.log(`[Proxy Adaptive] Direct returned ${response.status}. Switching to Tor...`);
                        response = await tryFetch(true);
                    }
                } catch (e) {
                    response = await tryFetch(true);
                }
            } else {
                try {
                    response = await tryFetch(true);
                    if (response.status >= 400 && response.status !== 404) {
                        response = await tryFetch(false);
                    }
                } catch (e) {
                    response = await tryFetch(false);
                }
            }
        } catch (finalErr: any) {
            throw finalErr;
        }

        if (response.status >= 400) {
            console.error(`[Proxy Fatal] Target returned ${response.status} for ${targetUrl}`);
            return res.status(response.status).send(`Target returned error ${response.status}`);
        }

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS, POST");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type, Date");

        let contentType = response.headers["content-type"];

        if (isM3U8 || (contentType && (contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL')))) {
            let content = "";
            if (typeof response.data === 'string') {
                content = response.data;
            } else if (Buffer.isBuffer(response.data)) {
                content = response.data.toString('utf-8');
            } else {
                content = "";
            }

            if (!content.includes('#EXTM3U') && !targetUrl.includes('.txt')) {
                return res.send(content);
            }

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const refParam = proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";

            const rewrittenLines = content.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return line;
                const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}`;
            });

            return res.send(rewrittenLines.join('\n'));
        }

        res.setHeader("Content-Type", contentType || (isSegment ? "video/mp2t" : "application/octet-stream"));
        if (response.headers["content-length"]) {
            res.setHeader("Content-Length", response.headers["content-length"]);
        }

        // Cleanup stream on close to prevent "crashing" (OOM/leaks)
        res.on('close', () => {
            if (response.data && typeof response.data.destroy === 'function') {
                response.data.destroy();
            }
        });

        response.data.pipe(res);

    } catch (error: any) {
        console.error(`[Proxy Exception] ${error.message} for ${targetUrl}`);
        if (!res.headersSent) {
            res.status(500).send("Proxy error: " + error.message);
        }
    }
}
