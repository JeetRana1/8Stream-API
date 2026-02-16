import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";
import stream from "stream";
import { promisify } from "util";

const pipeline = promisify(stream.pipeline);

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
const manifestCookieJar = new Map<string, { cookie: string; timestamp: number }>();
const MANIFEST_COOKIE_TTL_MS = 30 * 60 * 1000;
const manifestResponseCache = new Map<string, { body: string; expiresAt: number }>();
const MANIFEST_CACHE_TTL_MS = 60000;

function extractCookieHeader(setCookieHeader: string[] | undefined): string {
    if (!setCookieHeader || !setCookieHeader.length) return "";
    return setCookieHeader
        .map((raw) => raw.split(";")[0]?.trim())
        .filter(Boolean)
        .join("; ");
}

function getJarCookie(proxyRef: string | undefined): string {
    if (!proxyRef) return "";

    const now = Date.now();
    const direct = manifestCookieJar.get(proxyRef);
    if (direct && now - direct.timestamp <= MANIFEST_COOKIE_TTL_MS) {
        return direct.cookie;
    }

    try {
        const origin = new URL(proxyRef).origin;
        const originCookie = manifestCookieJar.get(origin);
        if (originCookie && now - originCookie.timestamp <= MANIFEST_COOKIE_TTL_MS) {
            return originCookie.cookie;
        }
    } catch { }

    return "";
}

function shouldPreferTor(url: string): boolean {
    const lower = url.toLowerCase();
    return (
        lower.includes("heast404jax.com") ||
        lower.includes("i-arch-") ||
        lower.includes("/stream2/") ||
        lower.includes("i-cdn-") ||
        lower.includes("lizer123.site")
    );
}

/**
 * Proxy controller optimized for maximum speed and HLS performance.
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = req.query.url as string;
    const host = req.get('host') || "";
    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol || "https";
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

    // Always set CORS headers early
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "*");

    // 0. Safety Valve: Smart Passthrough for Fragile Audio Providers (via Tor)
    if (targetUrl && (targetUrl.includes('lizer123') || targetUrl.includes('getm3u8'))) {
        try {
            const rawRes = await axios.get(targetUrl, {
                responseType: 'arraybuffer',
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                    "Accept": "*/*",
                    "Cache-Control": "no-cache"
                },
                httpAgent: torAgent,
                httpsAgent: torAgent,
                timeout: 20000,
                maxRedirects: 5,
                validateStatus: (status) => status < 400
            });

            const finalUrl = rawRes.request.res.responseUrl || targetUrl;
            const contentType = rawRes.headers['content-type'];

            if (contentType && (contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL') || finalUrl.includes('.m3u8'))) {
                let content = rawRes.data.toString('utf-8');
                const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
                const refParam = `&proxy_ref=${encodeURIComponent(finalUrl)}`;

                const rewrittenLines = content.split('\n').map((line: string) => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) return line;
                    const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}`;
                });

                res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.send(rewrittenLines.join('\n'));
            }

            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", contentType || 'application/video');
            return res.status(200).send(rawRes.data);
        } catch (e: any) {
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
                const playerUrl = await getPlayerUrl();
                const base = playerUrl.replace(/\/$/, '');
                targetUrl = pathSegment.startsWith('http') ? pathSegment : `${base}/stream/${pathSegment}`;
                if (query) targetUrl += `?${query}`;
            } catch (e) {
                const playerUrl = await getPlayerUrl();
                targetUrl = `${playerUrl.replace(/\/$/, '')}${fullPath}`;
            }
        }
    }

    if (!targetUrl) return res.status(400).send("Proxy Error: No URL");

    const proxyRef = req.query.proxy_ref as string;
    const isM3U8 = targetUrl.includes('.m3u8') || targetUrl.includes('.txt');
    const isSegment = targetUrl.includes('.ts') || targetUrl.includes('.mp4') || targetUrl.includes('.m4s')
        || targetUrl.includes('.aac') || targetUrl.includes('.ac3') || targetUrl.includes('.ec3') || targetUrl.includes('.m4a');

    try {
        const manifestCacheKey = `${targetUrl}|${String(req.query.proxy_ref || "")}`;

        // Fast-path manifest cache
        if (isM3U8) {
            const cachedManifest = manifestResponseCache.get(manifestCacheKey);
            if (cachedManifest && cachedManifest.expiresAt > Date.now()) {
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
                res.setHeader("Cache-Control", "public, max-age=5");
                return res.send(cachedManifest.body);
            }
        }

        const getProxyHeaders = (url: string, refererOverride?: string) => {
            const uri = new URL(url);
            let referer = refererOverride || proxyRef || "https://allmovieland.link/";

            if (!refererOverride && !proxyRef) {
                if (url.includes('slime') || url.includes('vekna')) {
                    referer = `https://${url.includes('slime') ? 'vekna402las.com' : uri.host}/`;
                } else if (url.includes('vidsrc')) {
                    referer = "https://vidsrc.me/";
                } else {
                    referer = `https://${uri.host}/`;
                }
            }

            const jarCookie = getJarCookie(proxyRef);

            return {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": new URL(referer).origin,
                "Accept": "*/*",
                "Connection": "keep-alive",
                "Range": req.headers.range,
                ...(jarCookie ? { "Cookie": jarCookie } : {})
            };
        };

        const tryFetch = async (useTor: boolean, refererOverride?: string, customTimeout?: number) => {
            // For streams, we can use a shorter connection timeout because we only wait for headers
            const timeout = customTimeout || (isSegment ? (useTor ? 12000 : 6000) : (useTor ? 12000 : 6000));
            return await axios.get(targetUrl, {
                headers: getProxyHeaders(targetUrl, refererOverride),
                httpAgent: useTor ? torAgent : undefined,
                httpsAgent: useTor ? torAgent : undefined,
                responseType: 'stream',
                timeout: timeout,
                maxRedirects: 5,
                validateStatus: (status) => status < 400
            });
        };

        const executeFetch = async (tor: boolean): Promise<any> => {
            try {
                return await tryFetch(tor);
            } catch (err: any) {
                // If it's a 403/401, we want to know so we can try the other lane
                err.isAuthError = err.response?.status === 403 || err.response?.status === 401;
                throw err;
            }
        };

        let response: any;
        const preferTor = shouldPreferTor(targetUrl);

        try {
            // UNIFIED STREAM RACING
            // We use Promise.any to race the connection establishment (TTFB).
            // Since we use responseType: 'stream', this resolves as soon as headers are received.
            // This is extremely light on memory and ensures the fastest path is chosen instantly.

            const reqs = [];

            // 1. Direct Request (Always try unless we know it's pointless, but for speed, let's try)
            // Actually, if we prefer Tor, we should perhaps delay Direct slightly? No, race them.
            // If Direct fails (403), it rejects fast. Tor takes over.
            reqs.push(executeFetch(false).then(r => ({ r, lane: 'direct' })));

            // 2. Tor Request
            reqs.push(executeFetch(true).then(r => ({ r, lane: 'tor' })));

            const winner = await Promise.any(reqs);
            response = winner.r;

        } catch (e: any) {
            throw new Error("Unreachable via Direct or Tor (All lanes failed)");
        }

        if (!response) throw new Error("Fetch yielded no response");

        // Set Headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "*");
        const contentType = response.headers["content-type"];

        if (isM3U8) {
            // For Manifests, we need to read the stream to string to rewrite it
            const streamToString = (stream: any): Promise<string> => {
                const chunks: any[] = [];
                return new Promise((resolve, reject) => {
                    stream.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
                    stream.on('error', (err: any) => reject(err));
                    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                });
            };

            let content = await streamToString(response.data);

            if (!content.includes('#EXTM3U')) return res.send(content);

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "public, max-age=5");

            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const cookieHeader = extractCookieHeader(response.headers["set-cookie"]);
            if (cookieHeader) {
                manifestCookieJar.set(targetUrl, { cookie: cookieHeader, timestamp: Date.now() });
            }

            const refParam = `&proxy_ref=${encodeURIComponent(targetUrl)}`;
            const rewrittenLines = content.split('\n').map((line: string) => {
                const trimmed = line.trim();
                if (!trimmed) return line;
                if (trimmed.includes('URI="')) {
                    return trimmed.replace(/URI="([^"]+)"/g, (match, relUrl) => {
                        const absUrl = relUrl.startsWith('http') ? relUrl : new URL(relUrl, baseUrl).href;
                        return `URI="${proxyBase}${encodeURIComponent(absUrl)}${refParam}"`;
                    });
                }
                if (!trimmed.startsWith('#') && (trimmed.includes('/') || trimmed.includes('.ts') || trimmed.includes('.m4s') || trimmed.length > 5)) {
                    const absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
                    return `${proxyBase}${encodeURIComponent(absUrl)}${refParam}`;
                }
                return line;
            });

            const rewrittenManifest = rewrittenLines.join('\n');
            manifestResponseCache.set(manifestCacheKey, {
                body: rewrittenManifest,
                expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS
            });
            return res.send(rewrittenManifest);
        }

        // For Segments: Pipe the stream directly using pipeline to handle errors and cleanup
        res.setHeader("Content-Type", contentType || (isSegment ? "video/mp2t" : "application/octet-stream"));
        res.setHeader("Cache-Control", isSegment ? "public, max-age=31536000, immutable" : "no-cache");

        if (response.headers["content-range"]) {
            res.setHeader("Content-Range", response.headers["content-range"]);
            res.status(206);
        }

        if (response.headers["content-length"]) {
            res.setHeader("Content-Length", response.headers["content-length"]);
        }

        // Pipe the response stream to the client
        return response.data.pipe(res);

    } catch (error: any) {
        console.error(`[Proxy Error] ${error.message} for ${targetUrl}`);
        if (!res.headersSent) {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.status(500).send(`Streaming unreachable: ${error.message}`);
        }
    }
}
