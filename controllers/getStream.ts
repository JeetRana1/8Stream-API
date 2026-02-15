import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl, getPlayerUrlWithOptions } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';
import cache from "../lib/cache";

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_CACHE_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STREAM_CACHE_MIN_SAFE_TTL_MS = 60 * 1000;

function getStreamCacheKey(token: string, key: string, proxyRef: string): string {
  return `stream_url_${token}_${key}_${proxyRef || "none"}`;
}

function getTokenOnlyStreamCacheKey(token: string, proxyRef: string): string {
  return `stream_url_token_${token}_${proxyRef || "none"}`;
}

function getTtlFromStreamUrl(url: string): number {
  try {
    const parsed = new URL(url);
    const expiresRaw = parsed.searchParams.get("expires");
    if (!expiresRaw) return STREAM_CACHE_TTL_MS;

    const expiresUnix = Number(expiresRaw);
    if (!Number.isFinite(expiresUnix) || expiresUnix <= 0) return STREAM_CACHE_TTL_MS;

    const safetyWindowMs = 5 * 60 * 1000;
    const ttl = (expiresUnix * 1000) - Date.now() - safetyWindowMs;

    if (ttl < STREAM_CACHE_MIN_SAFE_TTL_MS) return STREAM_CACHE_MIN_SAFE_TTL_MS;
    return Math.min(ttl, STREAM_CACHE_MAX_TTL_MS);
  } catch {
    return STREAM_CACHE_TTL_MS;
  }
}

function normalizeOpaqueValue(value: string): string {
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep raw value if it is not URI-encoded.
  }

  // Some clients/providers may turn "+" into spaces in transit.
  return value.replace(/ /g, "+").trim();
}

function toAbsoluteStreamUrl(value: unknown, baseDomain: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("http")) return trimmed;
    if (trimmed.startsWith("/")) return `${baseDomain}${trimmed}`;
    if (trimmed.startsWith("stream/") || trimmed.startsWith("stream2/")) {
      return `${baseDomain}/${trimmed}`;
    }
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const nested = obj.link || obj.url || obj.file || obj.stream || obj.data;
    if (nested) return toAbsoluteStreamUrl(nested, baseDomain);
  }

  return "";
}

function isManifestText(data: unknown, contentType?: string): boolean {
  if (typeof data !== "string") return false;
  const text = data.trim();
  if (!text) return false;

  if (text.startsWith("#EXTM3U")) return true;

  const ct = (contentType || "").toLowerCase();
  return (ct.includes("mpegurl") || ct.includes("vnd.apple.mpegurl")) && text.includes("#EXT");
}

function buildCandidateUrls(baseDomain: string, token: string, key: string): string[] {
  const normalized = token.startsWith("~") ? token.slice(1) : token;
  const tokenVariants = Array.from(new Set([normalized, `~${normalized}`]));
  const keyVariants = Array.from(new Set([
    key,
    key.replace(/\$/g, "")
  ])).filter(Boolean);

  return Array.from(new Set(
    tokenVariants.flatMap((value) => {
      const encoded = encodeURIComponent(value);
      const paths = [
        `${baseDomain}/playlist/${value}.txt`,
        `${baseDomain}/playlist/${encoded}.txt`,
        `${baseDomain}/playlist/${value}`,
        `${baseDomain}/playlist/${encoded}`,
        `${baseDomain}/stream/${value}`,
        `${baseDomain}/stream/${encoded}`,
        `${baseDomain}/stream2/${value}`,
        `${baseDomain}/stream2/${encoded}`,
      ];

      const withKey = keyVariants.flatMap((k) => [
        `${baseDomain}/stream/${value}?key=${encodeURIComponent(k)}`,
        `${baseDomain}/stream/${encoded}?key=${encodeURIComponent(k)}`,
        `${baseDomain}/stream/${value}?key=${k}`,
        `${baseDomain}/stream/${encoded}?key=${k}`,
        `${baseDomain}/stream2/${value}?key=${encodeURIComponent(k)}`,
        `${baseDomain}/stream2/${encoded}?key=${encodeURIComponent(k)}`,
        `${baseDomain}/stream2/${value}?key=${k}`,
        `${baseDomain}/stream2/${encoded}?key=${k}`,
      ]);

      return [...paths, ...withKey];
    })
  ));
}

function extractManifestUrlFromText(text: string, baseDomain: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // Absolute HLS URL in plain text or embedded JSON.
  const absMatch = trimmed.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
  if (absMatch?.[0]) return absMatch[0];

  // Relative HLS URL in body.
  const relMatch = trimmed.match(/(?:^|["'])(\/?[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (relMatch?.[1]) {
    const rel = relMatch[1];
    if (rel.startsWith("http")) return rel;
    if (rel.startsWith("/")) return `${baseDomain}${rel}`;
    return `${baseDomain}/${rel}`;
  }

  return "";
}

async function fetchUpstreamUrl(url: string, headers: Record<string, string>) {
  try {
    return await axios.get(url, { headers, timeout: 9000 });
  } catch {
    return await axios.get(url, {
      headers,
      httpAgent: torAgent,
      httpsAgent: torAgent,
      timeout: 13000
    });
  }
}

async function fetchUpstreamUrlViaTor(url: string, headers: Record<string, string>) {
  return await axios.get(url, {
    headers,
    httpAgent: torAgent,
    httpsAgent: torAgent,
    timeout: 13000
  });
}

async function isCachedStreamStillValid(streamUrl: string, refererHint: string): Promise<boolean> {
  try {
    const parsed = new URL(streamUrl);
    const expiresRaw = parsed.searchParams.get("expires");
    if (expiresRaw) {
      const expiresUnix = Number(expiresRaw);
      if (Number.isFinite(expiresUnix) && expiresUnix > 0) {
        const remainingMs = (expiresUnix * 1000) - Date.now();
        if (remainingMs > 5 * 60 * 1000) return true; // Speed Hack: Skip probe for young cache
        if (remainingMs < 2 * 60 * 1000) return false;
      }
    }
  } catch { }

  const defaultReferer = refererHint || (() => {
    try { return `${new URL(streamUrl).origin}/`; } catch { return ""; }
  })();

  const defaultOrigin = (() => {
    try { return new URL(defaultReferer).origin; } catch { return ""; }
  })();

  const probeHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "*/*",
    ...(defaultReferer ? { "Referer": defaultReferer } : {}),
    ...(defaultOrigin ? { "Origin": defaultOrigin } : {})
  };

  const isProbeValid = (status: number, contentType: string, body: unknown) => {
    if (status >= 400) return false;
    const ct = (contentType || "").toLowerCase();
    return ct.includes("mpegurl") || (typeof body === "string" && body.includes("#EXTM3U"));
  };

  try {
    const direct = await axios.get(streamUrl, { headers: probeHeaders, timeout: 3000, responseType: "text", validateStatus: () => true });
    if (isProbeValid(direct.status, String(direct.headers?.["content-type"] || ""), direct.data)) return true;
  } catch { }

  try {
    const tor = await axios.get(streamUrl, { headers: probeHeaders, httpAgent: torAgent, httpsAgent: torAgent, timeout: 7000, responseType: "text", validateStatus: () => true });
    return isProbeValid(tor.status, String(tor.headers?.["content-type"] || ""), tor.data);
  } catch {
    return false;
  }
}

async function evaluateCandidateResponse(
  response: any,
  candidateUrl: string,
  baseDomain: string,
  normalizedKey: string,
  onResolved: (url: string) => void
): Promise<boolean> {
  const contentType = String(response?.headers?.["content-type"] || "");
  const resolved = toAbsoluteStreamUrl(response?.data, baseDomain);
  if (resolved.startsWith("http")) {
    onResolved(resolved);
    return true;
  }

  const locationHeader = String(response?.headers?.location || "").trim();
  if (locationHeader) {
    const redirectUrl = locationHeader.startsWith("http") ? locationHeader : `${baseDomain}${locationHeader.startsWith("/") ? "" : "/"}${locationHeader}`;
    if (redirectUrl.startsWith("http")) {
      onResolved(redirectUrl);
      return true;
    }
  }

  if (isManifestText(response?.data, contentType)) {
    onResolved(candidateUrl);
    return true;
  }

  if (typeof response?.data === "string") {
    const embeddedUrl = extractManifestUrlFromText(response.data, baseDomain);
    if (embeddedUrl) {
      onResolved(embeddedUrl);
      return true;
    }

    const body = response.data.trim();
    if (body && !body.startsWith("{") && !body.includes("<html")) {
      const bodyClean = body.startsWith("~") ? body.slice(1) : body;
      const derivedCandidates = [
        `${baseDomain}/stream/${encodeURIComponent(bodyClean)}?key=${encodeURIComponent(normalizedKey)}`,
        `${baseDomain}/stream2/${encodeURIComponent(bodyClean)}?key=${encodeURIComponent(normalizedKey)}`
      ];

      for (const derived of derivedCandidates) {
        try {
          const verifyRes = await fetchUpstreamUrl(derived, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Referer": `${baseDomain}/`,
            "Origin": baseDomain,
            "X-Csrf-Token": normalizedKey,
            "x-csrf-token": normalizedKey
          });
          const verified = toAbsoluteStreamUrl(verifyRes?.data, baseDomain);
          if (verified.startsWith("http")) {
            onResolved(verified);
            return true;
          }
          if (isManifestText(verifyRes?.data, String(verifyRes?.headers?.["content-type"] || ""))) {
            onResolved(derived);
            return true;
          }
        } catch { }
      }
    }
  }

  if (response?.data && typeof response.data === "object") {
    const obj = response.data as Record<string, unknown>;
    const nestedToken = [obj.file, obj.path, obj.src, obj.stream].find((v) => typeof v === "string") as string | undefined;
    if (nestedToken) {
      const normalizedTokenCandidate = nestedToken.trim().startsWith("~") ? nestedToken.trim().slice(1) : nestedToken.trim();
      const derivedCandidates = [
        `${baseDomain}/stream/${encodeURIComponent(normalizedTokenCandidate)}?key=${encodeURIComponent(normalizedKey)}`,
        `${baseDomain}/stream2/${encodeURIComponent(normalizedTokenCandidate)}?key=${encodeURIComponent(normalizedKey)}`
      ];
      for (const derived of derivedCandidates) {
        try {
          const verifyRes = await fetchUpstreamUrl(derived, {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Referer": `${baseDomain}/`,
            "Origin": baseDomain,
            "X-Csrf-Token": normalizedKey,
            "x-csrf-token": normalizedKey
          });
          const verified = toAbsoluteStreamUrl(verifyRes?.data, baseDomain);
          if (verified.startsWith("http")) {
            onResolved(verified);
            return true;
          }
          if (isManifestText(verifyRes?.data, String(verifyRes?.headers?.["content-type"] || ""))) {
            onResolved(derived);
            return true;
          }
        } catch { }
      }
    }
  }

  return false;
}

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;
  if (!file || !key) return res.status(400).json({ success: false, message: "Missing file or key" });

  try {
    let finalStreamUrl = "";
    const normalizedKey = normalizeOpaqueValue(String(key));
    let token = normalizeOpaqueValue(String(file));
    let proxyRef = "";
    let refererHint = "";

    if (token.includes('proxy_ref=')) {
      const parts = token.split('?');
      token = parts[0];
      const searchParams = new URLSearchParams(parts[1]);
      proxyRef = decodeURIComponent(searchParams.get('proxy_ref') || "");
    }

    if (token.startsWith('http')) {
      finalStreamUrl = token;
      refererHint = proxyRef || (() => { try { return `${new URL(finalStreamUrl).origin}/`; } catch { return ""; } })();
    } else {
      const streamCacheKey = getStreamCacheKey(token, normalizedKey, proxyRef);
      const tokenOnlyStreamCacheKey = getTokenOnlyStreamCacheKey(token, proxyRef);
      const cachedStreamUrl = cache.get(streamCacheKey) || cache.get(tokenOnlyStreamCacheKey);
      let canUseCached = false;

      if (cachedStreamUrl) {
        finalStreamUrl = cachedStreamUrl;
        refererHint = proxyRef || (() => { try { return `${new URL(String(cachedStreamUrl)).origin}/`; } catch { return ""; } })();
        canUseCached = await isCachedStreamStillValid(finalStreamUrl, refererHint);
        if (!canUseCached) {
          cache.delete(streamCacheKey);
          cache.delete(tokenOnlyStreamCacheKey);
          finalStreamUrl = "";
        }
      }

      if (!canUseCached) {
        const [primaryPlayerUrl, refreshedPlayerUrl] = await Promise.all([getPlayerUrl(), getPlayerUrlWithOptions(true)]);
        const baseDomainCandidates = Array.from(new Set([
          (proxyRef || "").replace(/\/$/, ''),
          String(primaryPlayerUrl || "").trim().replace(/\/$/, ''),
          String(refreshedPlayerUrl || "").trim().replace(/\/$/, ''),
          String(process.env.FALLBACK_PLAYER_URL_1 || "").trim().replace(/\/$/, ''),
          String(process.env.FALLBACK_PLAYER_URL_2 || "").trim().replace(/\/$/, ''),
          "https://heast404jax.com",
          "https://vekna402las.com"
        ].filter(Boolean)));

        const refererCandidates = ["https://allmovieland.link/", "https://google.com/"];

        const processDomain = async (baseDomain: string) => {
          if (finalStreamUrl) return;
          const currentRefererHint = `${baseDomain}/`;
          const candidateUrls = buildCandidateUrls(baseDomain, token, normalizedKey);
          const perDomainReferers = Array.from(new Set([`${baseDomain}/`, ...refererCandidates]));

          for (const url of candidateUrls) {
            if (finalStreamUrl) return;
            const headers = {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Referer": perDomainReferers[0],
              "Origin": perDomainReferers[0].replace(/\/$/, ''),
              "X-Csrf-Token": normalizedKey,
              "x-csrf-token": normalizedKey,
              "X-Requested-With": "XMLHttpRequest",
              "Accept": "*/*"
            };

            try {
              const result = await Promise.any([
                axios.get(url, { headers, timeout: 5000 }).then(r => ({ r })),
                fetchUpstreamUrlViaTor(url, headers).then(r => ({ r }))
              ]);
              if (await evaluateCandidateResponse(result.r, url, baseDomain, normalizedKey, (resUrl) => { finalStreamUrl = resUrl; })) {
                refererHint = currentRefererHint;
                break;
              }
            } catch {
              for (let i = 1; i < perDomainReferers.length; i++) {
                if (finalStreamUrl) return;
                try {
                  const r = await fetchUpstreamUrl(url, { ...headers, Referer: perDomainReferers[i], Origin: perDomainReferers[i].replace(/\/$/, '') });
                  if (await evaluateCandidateResponse(r, url, baseDomain, normalizedKey, (resUrl) => { finalStreamUrl = resUrl; })) {
                    refererHint = currentRefererHint;
                    return;
                  }
                } catch { }
              }
            }
          }
        };

        await Promise.all(baseDomainCandidates.slice(0, 3).map(processDomain));
        if (!finalStreamUrl) {
          for (const domain of baseDomainCandidates.slice(3)) {
            if (finalStreamUrl) break;
            await processDomain(domain);
          }
        }

        if (finalStreamUrl && finalStreamUrl.startsWith("http")) {
          const ttl = getTtlFromStreamUrl(finalStreamUrl);
          cache.set(streamCacheKey, finalStreamUrl, ttl);
          cache.set(tokenOnlyStreamCacheKey, finalStreamUrl, ttl);
        } else {
          const fallbackUrl = cache.get(tokenOnlyStreamCacheKey);
          if (fallbackUrl && fallbackUrl.startsWith("http") && await isCachedStreamStillValid(fallbackUrl, refererHint)) {
            finalStreamUrl = fallbackUrl;
          } else {
            throw new Error(`Unable to resolve stream URL.`);
          }
        }
      }
    }

    const host = req.get('host');
    const proxySuffix = refererHint ? `&proxy_ref=${encodeURIComponent(refererHint)}` : "";
    res.json({ success: true, data: { link: `https://${host}/api/v1/proxy?url=${encodeURIComponent(finalStreamUrl)}${proxySuffix}` } });

  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
