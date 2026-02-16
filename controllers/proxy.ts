import axios from "axios";
import { Request, Response } from "express";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getPlayerUrl } from "../lib/getPlayerUrl";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
const manifestCookieJar = new Map<string, { cookie: string; timestamp: number }>();
const MANIFEST_COOKIE_TTL_MS = 30 * 60 * 1000;
const manifestResponseCache = new Map<string, { body: string; expiresAt: number }>();
const MANIFEST_CACHE_TTL_MS = 10000;

// Optimized Segment Cache (LRU-like)
const SEGMENT_CACHE_LIMIT = 100; // Cache last 100 segments
const segmentCache = new Map<string, { data: Buffer; contentType: string; headers: any }>();
const segmentCacheLastUsed: string[] = [];

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
    const isSegment = targetUrl.includes('.ts') || targetUrl.includes('.mp4') || targetUrl.includes('.m4s');

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

        // Fast-path segment cache
        if (isSegment) {
            const cachedSegment = segmentCache.get(targetUrl);
            if (cachedSegment) {
                console.log(`[Proxy Cache] Serving cached segment: ${targetUrl.substring(0, 40)}...`);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", cachedSegment.contentType);
                res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
                res.setHeader("X-Cache", "HIT");

                // Handle Range for cached items
                if (req.headers.range) {
                    const range = req.headers.range;
                    const parts = range.replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : cachedSegment.data.length - 1;
                    const chunk = cachedSegment.data.slice(start, end + 1);
                    res.setHeader("Content-Range", `bytes ${start}-${end}/${cachedSegment.data.length}`);
                    res.setHeader("Content-Length", chunk.length);
                    return res.status(206).send(chunk);
                }

                return res.send(cachedSegment.data);
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
            const timeout = customTimeout || (isSegment ? (useTor ? 30000 : 15000) : (useTor ? 12000 : 6000));
            return await axios.get(targetUrl, {
                headers: getProxyHeaders(targetUrl, refererOverride),
                httpAgent: useTor ? torAgent : undefined,
                httpsAgent: useTor ? torAgent : undefined,
                responseType: isSegment ? 'arraybuffer' : 'text', // Changed to arraybuffer for segments to allow caching
                timeout: timeout,
                maxRedirects: 5,
                validateStatus: (status) => status < 400
            });
        };

        let response;
        const preferTor = shouldPreferTor(targetUrl);

        if (isM3U8) {
            // Manifest Speed Optimization: Parallel Fetching
            // If not forced Tor, try both Direct and Tor in parallel and take the winner
            if (!preferTor) {
                try {
                    // Start both, but wrap them so we can identify success
                    const directPromise = tryFetch(false).then(r => ({ r, tor: false }));
                    const torPromise = tryFetch(true).then(r => ({ r, tor: true }));

                    // Race them, but we only want the FIRST successful one
                    const firstSuccess = await Promise.any([directPromise, torPromise]);
                    response = firstSuccess.r;
                    console.log(`[Proxy Manifest] ${firstSuccess.tor ? 'Tor' : 'Direct'} won race for ${targetUrl.substring(0, 40)}`);
                } catch (e) {
                    // If both failed, we throw
                    throw new Error("Both Direct and Tor failed for manifest");
                }
            } else {
                try {
                    response = await tryFetch(true);
                } catch {
                    response = await tryFetch(false);
                }
            }
        } else {
            // Segment Optimization: Sequential with aggressive fallback
            if (preferTor) {
                response = await tryFetch(true);
            } else {
                try {
                    response = await tryFetch(false);
                } catch (e: any) {
                    if (e.message.includes('403') || e.message.includes('401') || e.code === 'ECONNABORTED') {
                        response = await tryFetch(true);
                    } else {
                        throw e;
                    }
                }
            }
        }

        if (!response) throw new Error("Fetch failed");

        // Set Headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "*");

        const contentType = response.headers["content-type"];

        if (isM3U8) {
            let content = response.data.toString();
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

        // Segment Logic
        const dataBuffer = Buffer.from(response.data);

        // Save to cache
        if (isSegment && dataBuffer.length < 5 * 1024 * 1024) { // Only cache segments < 5MB
            if (segmentCache.size >= SEGMENT_CACHE_LIMIT) {
                const oldest = segmentCacheLastUsed.shift();
                if (oldest) segmentCache.delete(oldest);
            }
            segmentCache.set(targetUrl, {
                data: dataBuffer,
                contentType: contentType || "video/mp2t",
                headers: response.headers
            });
            segmentCacheLastUsed.push(targetUrl);
        }

        res.setHeader("Content-Type", contentType || (isSegment ? "video/mp2t" : "application/octet-stream"));
        res.setHeader("Cache-Control", isSegment ? "public, max-age=31536000, immutable" : "no-cache");

        if (response.headers["content-range"]) {
            res.setHeader("Content-Range", response.headers["content-range"]);
            res.status(206);
        }

        return res.send(dataBuffer);

    } catch (error: any) {
        if (!isSegment) console.error(`[Proxy Fatal] ${error.message} for ${targetUrl}`);
        if (!res.headersSent) res.status(500).send("Streaming unreachable");
    }
}
