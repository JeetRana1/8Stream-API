import { Request, Response } from "express";
import getInfo from "../lib/getInfo";
import { resolveImdbToTmdb, resolveTmdbToImdb } from "../lib/tmdbResolver";
import cache from "../lib/cache";

const MEDIAINFO_SUCCESS_CACHE_TTL_MS = Number(process.env.MEDIAINFO_SUCCESS_CACHE_TTL_MS || 5 * 60 * 1000);
const MEDIAINFO_FAILURE_CACHE_TTL_MS = Number(process.env.MEDIAINFO_FAILURE_CACHE_TTL_MS || 2 * 60 * 1000);
const MEDIAINFO_STALE_SUCCESS_CACHE_TTL_MS = Number(process.env.MEDIAINFO_STALE_SUCCESS_CACHE_TTL_MS || 6 * 60 * 60 * 1000);

function getStaleSuccessCacheKey(id: string, mediaType: string) {
  return `mediaInfo_stale_success_${id}_${mediaType}`;
}

export default async function mediaInfo(req: Request, res: Response) {
  let { id, type } = req.query;
  if (!id) {
    return res.json({
      success: false,
      message: "Please provide a valid id",
    });
  }

  const mediaType = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  // Create cache key for the entire mediaInfo request
  const cacheKey = `mediaInfo_${id}_${mediaType}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    // Do not trust cached imdb failures blindly; mirrors frequently flip imdb support.
    const isImdbRequest = String(id).startsWith('tt');
    if ((cachedResult as any)?.success || !isImdbRequest) {
      console.log(`[mediaInfo] Returning cached result for ID: ${id}`);
      return res.json(cachedResult);
    }
    console.log(`[mediaInfo] Cached imdb failure for ${id}. Trying fresh TMDB fallback before returning cache...`);
  }

  try {
    const requestedId = String(id);
    const candidates: string[] = [];

    // Always include the requested ID first.
    candidates.push(requestedId);

    if (requestedId.startsWith('tt')) {
      const tmdbFallbackId = await resolveImdbToTmdb(requestedId, mediaType as any);
      if (tmdbFallbackId && tmdbFallbackId !== requestedId) {
        candidates.push(tmdbFallbackId);
      }
    } else {
      const imdbFallbackId = await resolveTmdbToImdb(requestedId, mediaType as any);
      if (imdbFallbackId && imdbFallbackId !== requestedId) {
        candidates.push(imdbFallbackId);
      }
    }

    const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));
    console.log(`[mediaInfo] Multi-ID Parallel Resolution for ${requestedId}: ${uniqueCandidates.join(" & ")}`);

    // 💡 Performance Hack: Return as soon as we find a winner
    const data = await new Promise<any>((resolve) => {
      let finished = 0;
      let bestFailure: any = null;

      if (uniqueCandidates.length === 0) return resolve({ success: false, message: "No IDs to search." });

      uniqueCandidates.forEach(async (candidate) => {
        try {
          const res = await getInfo(candidate);
          if (res?.success) {
            resolve(res);
          } else {
            bestFailure = res;
          }
        } catch (err) {
          bestFailure = { success: false, message: String(err) };
        } finally {
          finished++;
          if (finished === uniqueCandidates.length) {
            resolve(bestFailure || { success: false, message: "Media not found" });
          }
        }
      });
    });

    console.log(`[mediaInfo] Response for ${requestedId}:`, data?.success ? "SUCCESS" : "FAILED");

    // Cache success briefly: upstream file/key tokens are short-lived and become invalid.
    if (data.success) {
      cache.set(cacheKey, data, MEDIAINFO_SUCCESS_CACHE_TTL_MS);
      const staleKeys = Array.from(new Set([requestedId, ...uniqueCandidates]));
      staleKeys.forEach((value) => {
        cache.set(getStaleSuccessCacheKey(value, mediaType), data, MEDIAINFO_STALE_SUCCESS_CACHE_TTL_MS);
      });
    } else {
      // If upstream is temporarily failing, serve most recent known-good result.
      const staleKeys = Array.from(new Set([requestedId, ...uniqueCandidates]));
      for (const value of staleKeys) {
        const staleSuccess = cache.get(getStaleSuccessCacheKey(value, mediaType));
        if ((staleSuccess as any)?.success) {
          console.log(`[mediaInfo] Upstream failure. Returning stale success for ${value}.`);
          const staleResponse = {
            ...(staleSuccess as any),
            stale: true
          };
          cache.set(cacheKey, staleResponse, 45 * 1000);
          return res.json(staleResponse);
        }
      }
      // Cache failed results for shorter duration to allow retries
      cache.set(cacheKey, data, MEDIAINFO_FAILURE_CACHE_TTL_MS);
    }

    res.json(data);
  } catch (err) {
    console.log("error in mediaInfo: ", err);

    // Send error response
    const errorResponse = {
      success: false,
      message: "Internal server error: " + (err instanceof Error ? err.message : String(err)),
    };

    // Cache the error response briefly to prevent retry storms.
    cache.set(cacheKey, errorResponse, MEDIAINFO_FAILURE_CACHE_TTL_MS);

    res.status(500).json(errorResponse);
  }
}
