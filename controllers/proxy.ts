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
const MANIFEST_CACHE_TTL_MS = 30000; // Increased to 30s for better stability

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
            const contentType = rawRes.headers['content-type'];

            res.setHeader('Content-Type', contentType || 'application/octet-stream');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.send(rawRes.data);
            return;
        } catch (e: any) {
            console.error(`[Proxy Raw] Error: ${e.message}`);
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(500).send("Audio Proxy Error");
            return;
        }
    }

    if (!targetUrl) return res.status(400).send("Missing URL");

    try {
        const urlObj = new URL(targetUrl);
        const targetHost = urlObj.hostname;
        const isM3U8 = targetUrl.includes(".m3u8");
        const isSegment = targetUrl.includes(".ts") || targetUrl.includes(".m4s") || targetUrl.includes(".mp4");
        const proxyRef = req.query.proxy_ref as string | undefined;

        // Cleanup stale host block cache
        const now = Date.now();
        if (hostNeedsTor.has(targetHost)) {
            const entry = hostNeedsTor.get(targetHost)!;
            if (now - entry.timestamp > HOST_BLOCK_TTL) {
                hostNeedsTor.delete(targetHost);
            }
        }

        // Cache mechanism for manifest files (HLS speedup)
        if (isM3U8) {
            const cached = manifestResponseCache.get(targetUrl);
            if (cached && cached.expiresAt > now) {
                res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
                res.setHeader("X-Proxy-Cache", "HIT");
                res.setHeader("Cache-Control", "public, max-age=15");
                return res.send(cached.body);
            }
        }

        const getProxyHeaders = (url: string, refererOverride?: string) => {
            const uri = new URL(url);
            const referer = refererOverride || proxyRef || `${uri.origin}/`;
            const cookie = getJarCookie(proxyRef);

            return {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": referer,
                "Origin": new URL(referer).origin,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache",
                ...(cookie ? { "Cookie": cookie } : {})
            };
        };

        const tryFetch = async (useTor: boolean, refererOverride?: string) => {
            const manifestTimeoutMs = useTor ? 12000 : 4000; // Even tighter for mobile startup
            const segmentTimeoutMs = useTor ? 25000 : 12000;

            const uri = new URL(targetUrl);
            const isHttps = uri.protocol === 'https:';

            return await axios.get(targetUrl, {
                headers: {
                    ...getProxyHeaders(targetUrl, refererOverride),
                    "Accept-Encoding": "gzip, deflate, br"
                },
                httpAgent: useTor ? torAgent : (isHttps ? undefined : keepAliveHttpAgent),
                httpsAgent: useTor ? torAgent : (isHttps ? keepAliveHttpsAgent : undefined),
                responseType: isM3U8 ? 'text' : 'stream',
                timeout: isSegment ? segmentTimeoutMs : manifestTimeoutMs,
                maxRedirects: 3,
                validateStatus: (status) => status < 400,
                decompress: true
            });
        };

        let response: any;
        const needsTorCached = hostNeedsTor.has(targetHost);

        try {
            const preferTor = shouldPreferTor(targetUrl);
            if (preferTor || needsTorCached) {
                try {
                    response = await tryFetch(true);
                } catch (e: any) {
                    if (!needsTorCached) {
                        response = await tryFetch(false);
                    } else throw e;
                }
            } else {
                try {
                    response = await tryFetch(false);
                } catch (e: any) {
                    const isBlock = e.response?.status === 403 || e.response?.status === 401;
                    if (isBlock || e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
                        hostNeedsTor.set(targetHost, { timestamp: Date.now() });
                        response = await tryFetch(true);
                    } else throw e;
                }
            }
        } catch (finalErr: any) {
            // Final failover attempt: refresh parent manifest domain as last resort
            if (proxyRef && !targetUrl.includes(new URL(proxyRef).hostname)) {
                try {
                    response = await tryFetch(true, `${new URL(targetUrl).origin}/`);
                } catch {
                    throw finalErr;
                }
            } else throw finalErr;
        }

        const contentType = response.headers["content-type"];

        // Set mandatory CORS and security headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        // 3. Recursive HLS Rewriting (Manifests)
        if (isM3U8 || (contentType && (contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL')))) {
            let content = "";
            if (typeof response.data === 'string') {
                content = response.data;
            } else if (Buffer.isBuffer(response.data)) {
                content = response.data.toString('utf-8');
            }

            // Capture Cookies from manifest for subsequent segment requests
            const setCookie = response.headers["set-cookie"];
            if (setCookie && proxyRef) {
                manifestCookieJar.set(proxyRef, {
                    cookie: extractCookieHeader(setCookie),
                    timestamp: Date.now()
                });
            }

            // Rewrite relative and absolute URLs in manifest to point back through this proxy
            const lines = content.split("\n");
            const rewrittenLines = lines.map((line: string) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#")) {
                    // Specific fix: handle #EXT-X-KEY and similar metadata URLs
                    if (trimmed.startsWith("#EXT-X-KEY") && trimmed.includes('URI="')) {
                        return trimmed.replace(/URI="([^"]+)"/, (match: string, uri: string) => {
                            const abs = uri.startsWith("http") ? uri : new URL(uri, targetUrl).href;
                            return `URI="${proxyBase}${encodeURIComponent(abs)}${proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : ""}"`;
                        });
                    }
                    return line;
                }
                const absolutePath = trimmed.startsWith("http") ? trimmed : new URL(trimmed, targetUrl).href;
                return `${proxyBase}${encodeURIComponent(absolutePath)}${proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : ""}`;
            });

            const finalBody = rewrittenLines.join("\n");
            manifestResponseCache.set(targetUrl, {
                body: finalBody,
                expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS
            });

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "public, max-age=15");
            return res.send(finalBody);
        }

        // 4. Handle Binary/Segment Data (Piping)
        res.setHeader("Content-Type", contentType || (isSegment ? "video/mp2t" : "application/octet-stream"));
        if (isSegment) {
            res.setHeader("Cache-Control", "public, max-age=86400, immutable");
        }

        if (response.headers["content-length"]) {
            res.setHeader("Content-Length", response.headers["content-length"]);
        }

        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }

        response.data.pipe(res);

    } catch (error: any) {
        if (!res.headersSent) {
            res.status(500).send("Proxy Error");
        }
    }
}
