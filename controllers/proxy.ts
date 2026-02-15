import axios from "axios";
import { Request, Response } from "express";
import {
    torAgent,
    keepAliveHttpAgent,
    keepAliveHttpsAgent,
    hostNeedsTor,
    HOST_BLOCK_TTL,
    shouldPreferTor
} from "../lib/proxyAgents";

const manifestCookieJar = new Map<string, { cookie: string; timestamp: number }>();
const MANIFEST_COOKIE_TTL_MS = 30 * 60 * 1000;
const manifestResponseCache = new Map<string, { body: string; expiresAt: number }>();
const MANIFEST_CACHE_TTL_MS = 30000;

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
    if (direct && now - direct.timestamp <= MANIFEST_COOKIE_TTL_MS) return direct.cookie;
    try {
        const origin = new URL(proxyRef).origin;
        const originCookie = manifestCookieJar.get(origin);
        if (originCookie && now - originCookie.timestamp <= MANIFEST_COOKIE_TTL_MS) return originCookie.cookie;
    } catch { }
    return "";
}

/**
 * Universal Proxy Controller
 * Handles Manifest Rewriting, Audio Track Support, and Tor Failover
 */
export default async function proxy(req: Request, res: Response) {
    let targetUrl = (req.query.url as string) || (req.params[0] ? req.params[0] : "");
    const host = req.get('host') || "";
    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol || "https";
    const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

    // Handle path-based catch-all (/stream/*)
    if (!req.query.url && req.path.includes('/stream/')) {
        const match = req.path.match(/\/stream\/(.+)$/);
        if (match && match[1]) {
            targetUrl = match[1];
            // Some providers use base64 in the path, some don't.
            // If it doesn't look like a URL, it might be encoded.
            if (!targetUrl.startsWith('http')) {
                try {
                    targetUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
                } catch { }
            }
        }
    }

    if (!targetUrl) return res.status(400).send("Missing target URL");

    // 0. Loop Protection: Recursively unwrap anything pointing back to us
    const isInternal = (url: string) => {
        try {
            const u = new URL(url);
            const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0';
            const isOurHost = u.hostname === host.split(':')[0];
            return isLocal || isOurHost;
        } catch {
            return false;
        }
    };

    while (targetUrl && isInternal(targetUrl)) {
        console.warn(`[Proxy] Unwrapping internal link: ${targetUrl}`);
        // 1. Un-nest ?url=
        const nestedMatch = targetUrl.match(/[?&]url=([^&]+)/);
        if (nestedMatch && nestedMatch[1]) {
            targetUrl = decodeURIComponent(nestedMatch[1]);
            continue;
        }
        // 2. Un-nest /stream/path (catch base64)
        const streamMatch = targetUrl.match(/\/stream\/([^?#/]+)/);
        if (streamMatch && streamMatch[1]) {
            let decoded = streamMatch[1];
            if (!decoded.startsWith('http') && /^[A-Za-z0-9+/=]+$/.test(decoded)) {
                try {
                    decoded = Buffer.from(decoded, 'base64').toString('utf-8');
                } catch { }
            }
            if (decoded && decoded !== streamMatch[1] && decoded.startsWith('http')) {
                targetUrl = decoded;
                continue;
            }
        }
        break;
    }

    if (!targetUrl || !targetUrl.startsWith('http')) {
        // Fallback: if it's still missing protocol, it might be a broken unwrap
        if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
        else if (!targetUrl.startsWith('http')) return res.status(400).send("Invalid Proxy Target");
    }

    try {
        const urlObj = new URL(targetUrl);
        const targetHost = urlObj.hostname;

        // Improved detection: identify manifests even without .m3u8 extension
        const isM3U8 = targetUrl.includes(".m3u8") ||
            targetUrl.includes("getm3u8") ||
            targetUrl.includes("/playlist") ||
            targetUrl.includes("m3u8") ||
            req.query.type === 'm3u8';

        const isSegment = targetUrl.includes(".ts") ||
            targetUrl.includes(".m4s") ||
            targetUrl.includes(".mp4") ||
            targetUrl.includes(".aac") ||
            targetUrl.includes("/segment");
        const proxyRef = (req.query.proxy_ref as string) || (req.headers.referer && !req.headers.referer.includes(host) ? req.headers.referer : undefined);

        // Cleanup stale host block cache
        const now = Date.now();
        if (hostNeedsTor.has(targetHost)) {
            const entry = hostNeedsTor.get(targetHost)!;
            if (now - entry.timestamp > HOST_BLOCK_TTL) hostNeedsTor.delete(targetHost);
        }

        // Cache hit for manifests
        if (isM3U8) {
            const cached = manifestResponseCache.get(targetUrl);
            if (cached && cached.expiresAt > now) {
                res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
                res.setHeader("X-Proxy-Cache", "HIT");
                res.setHeader("Access-Control-Allow-Origin", "*");
                return res.send(cached.body);
            }
        }

        const getProxyHeaders = (url: string, refererOverride?: string) => {
            const uri = new URL(url);
            const referer = refererOverride || proxyRef || `${uri.origin}/`;
            const cookie = getJarCookie(proxyRef);

            const headers: any = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": new URL(referer).origin,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache"
            };
            if (cookie) headers["Cookie"] = cookie;
            return headers;
        };

        const tryFetch = async (useTor: boolean, refererOverride?: string) => {
            const timeout = isSegment ? (useTor ? 30000 : 15000) : (useTor ? 15000 : 8000);

            // Fetch everything as 'arraybuffer' first if it's likely a small manifest
            // This allows us to check headers BEFORE deciding to treat as text or stream
            const responseType = (isM3U8 && !isSegment) ? 'text' : 'stream';

            return await axios.get(targetUrl, {
                headers: {
                    ...getProxyHeaders(targetUrl, refererOverride),
                    "Accept-Encoding": "gzip, deflate, br"
                },
                httpAgent: useTor ? torAgent : (urlObj.protocol === 'https:' ? undefined : keepAliveHttpAgent),
                httpsAgent: useTor ? torAgent : (urlObj.protocol === 'https:' ? keepAliveHttpsAgent : undefined),
                responseType: responseType,
                timeout: timeout,
                maxRedirects: 5,
                decompress: true,
                validateStatus: (status) => status < 400
            });
        };

        let response: any;
        const needsTorCached = hostNeedsTor.has(targetHost) || shouldPreferTor(targetUrl);

        try {
            response = await tryFetch(needsTorCached);
        } catch (e: any) {
            if (!needsTorCached && (e.response?.status === 403 || e.response?.status === 401 || e.code === 'ECONNABORTED')) {
                hostNeedsTor.set(targetHost, { timestamp: Date.now() });
                response = await tryFetch(true);
            } else throw e;
        }

        const contentType = response.headers["content-type"] || "";
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        // --- MANIFEST REWRITING (The Heart of Audio Switching) ---
        if (isM3U8 || contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL') || (typeof response.data === 'string' && response.data.startsWith('#EXTM3U'))) {
            let content = "";
            if (typeof response.data === 'string') {
                content = response.data;
            } else if (Buffer.isBuffer(response.data)) {
                content = response.data.toString('utf-8');
            } else if (response.data && typeof response.data.toString === 'function') {
                // If it's a stream or other object, we need to handle it carefully.
                // However, tryFetch now returns 'text' if isM3U8 is true.
                content = response.data.toString();
            }

            // Capture Cookies
            const setCookie = response.headers["set-cookie"];
            if (setCookie && proxyRef) {
                manifestCookieJar.set(proxyRef, {
                    cookie: extractCookieHeader(setCookie),
                    timestamp: Date.now()
                });
            }

            const lines = content.split("\n");
            const proxySuffix = proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";

            const isAlreadyProxied = (url: string) => {
                const lower = url.toLowerCase();
                return lower.includes('/api/v1/proxy') || lower.includes('/stream/') || lower.includes(host.split(':')[0].toLowerCase());
            };

            const rewrittenLines = lines.map((line: string) => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                if (trimmed.startsWith("#")) {
                    // Tag Rewriting (Audio, Subtitles, Keys, Maps)
                    return trimmed.replace(/(URI|SRC|EXT-X-MAP:URI|EXT-X-KEY:URI)=["']([^"']+)["']/g, (match: string, attr: string, uri: string) => {
                        if (isAlreadyProxied(uri)) return match;
                        const abs = uri.startsWith("http") ? uri : new URL(uri, targetUrl).href;
                        return `${attr}="${proxyBase}${encodeURIComponent(abs)}${proxySuffix}"`;
                    });
                }

                // Path Rewriting (Segments, Variant Manifests)
                if (trimmed.startsWith('http') || (!trimmed.includes(':') && trimmed.includes('.')) || trimmed.startsWith('/')) {
                    if (isAlreadyProxied(trimmed)) return line;
                    const abs = trimmed.startsWith("http") ? trimmed : new URL(trimmed, targetUrl).href;
                    // If the absolute URL points back to us, don't proxy it again
                    if (isAlreadyProxied(abs)) return trimmed;
                    return `${proxyBase}${encodeURIComponent(abs)}${proxySuffix}`;
                }

                return line;
            });

            const finalBody = rewrittenLines.join("\n");
            manifestResponseCache.set(targetUrl, {
                body: finalBody,
                expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS
            });

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            return res.send(finalBody);
        }

        // --- BINARY DATA (Segments, Audio Chunks) ---
        res.setHeader("Content-Type", contentType || (isSegment ? "video/mp2t" : "application/octet-stream"));
        if (isSegment) res.setHeader("Cache-Control", "public, max-age=86400, immutable");

        if (response.headers["content-length"]) res.setHeader("Content-Length", response.headers["content-length"]);
        if (typeof res.flushHeaders === 'function') res.flushHeaders();

        if (response.data.pipe) {
            response.data.pipe(res);
        } else {
            res.send(response.data);
        }

    } catch (error: any) {
        console.error(`[Proxy Error] ${targetUrl} -> ${error.message}`);
        if (!res.headersSent) {
            res.status(500).send(`Proxy Error: ${error.message}`);
        }
    }
}
