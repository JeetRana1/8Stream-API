import { Request, Response } from "express";
import getInfo from "../lib/getInfo";
import { resolveImdbToTmdb, resolveTmdbToImdb } from "../lib/tmdbResolver";
import cache from "../lib/cache";
import { scrapeAll } from "../lib/scrapers";

const MEDIAINFO_SUCCESS_CACHE_TTL_MS = Number(process.env.MEDIAINFO_SUCCESS_CACHE_TTL_MS || 5 * 60 * 1000);
const MEDIAINFO_FAILURE_CACHE_TTL_MS = Number(process.env.MEDIAINFO_FAILURE_CACHE_TTL_MS || 2 * 60 * 1000);

export default async function mediaInfo(req: Request, res: Response) {
  let { id, type, s, e } = req.query;
  if (!id) {
    return res.json({
      success: false,
      message: "Please provide a valid id",
    });
  }

  // Create cache key for the entire mediaInfo request
  const cacheKey = `mediaInfo_${id}_${type || 'movie'}_${s || 0}_${e || 0}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log(`[mediaInfo] Returning cached result for ID: ${id}`);
    return res.json(cachedResult);
  }

  try {
    let finalId = id as string;

    // Auto-resolve TMDB IDs (e.g. 550 -> tt0137523)
    if (!finalId.startsWith('tt')) {
      finalId = await resolveTmdbToImdb(finalId, (type as any) || 'movie');
    }

    console.log(`Received request for ID: ${id} (Resolved: ${finalId})`);
<<<<<<< HEAD
    let data = await getInfo(finalId);

    // Upstream providers sometimes stop supporting imdb IDs on /play/*.
    // If imdb lookup fails, retry once using TMDB numeric ID.
    if (!data.success && finalId.startsWith('tt')) {
      const tmdbFallbackId = await resolveImdbToTmdb(finalId, (type as any) || 'movie');
      if (tmdbFallbackId && tmdbFallbackId !== finalId) {
        console.log(`[mediaInfo] IMDb lookup failed. Retrying with TMDB ID: ${tmdbFallbackId}`);
        data = await getInfo(tmdbFallbackId);
      }
    }

    console.log(`Response data:`, data);
    
    // Cache success briefly: upstream file/key tokens are short-lived and become invalid.
    if (data.success) {
      cache.set(cacheKey, data, MEDIAINFO_SUCCESS_CACHE_TTL_MS);
    } else {
      // Cache failed results for shorter duration to allow retries
      cache.set(cacheKey, data, MEDIAINFO_FAILURE_CACHE_TTL_MS);
=======

    // Fetch primary stream info (8Stream/AllMovieLand)
    const data = await getInfo(finalId);

    // Fetch from new providers
    let extraSources: any[] = [];
    try {
      // Trigger scrapers for the ORIGINAL ID (TMDB or IMDB)
      // Some scrapers like VidSrcMe need TMDB ID, others work with IMDB
      const { scrapeAll } = require("../lib/scrapers");
      extraSources = await scrapeAll(
        finalId, // Use resolved IMDB ID for better compatibility
        (type as any) || 'movie',
        s ? parseInt(s as string) : (type === 'tv' ? 1 : undefined),
        e ? parseInt(e as string) : (type === 'tv' ? 1 : undefined)
      );
    } catch (e) {
      console.error("[mediaInfo] New scrapers failed:", e);
>>>>>>> 4b1fb64253e6d9d93dfed6a87f75e1e232681780
    }

    // Ensure data has the correct structure
    const baseData = data.success ? data : {
      success: false,
      data: {
        playlist: [],
        key: ""
      },
      message: data.message || "Primary source unavailable"
    };

    // Combine data with consistent structure
    const enhancedData = {
      success: baseData.success || extraSources.length > 0,
      data: baseData.data || {
        playlist: [],
        key: ""
      },
      message: baseData.success ? undefined : (extraSources.length > 0 ? "Using alternative sources" : "No streams available"),
      extraSources: extraSources,
      source: "8stream"
    };

    console.log(`Response data (enhanced):`, {
      success: enhancedData.success,
      primarySuccess: baseData.success,
      extraSourcesCount: extraSources.length,
      message: enhancedData.message
    });

    // Cache the result if successful or if we have extra sources
    if (enhancedData.success) {
      cache.set(cacheKey, enhancedData, 30 * 60 * 1000);
    } else {
      // Cache failed result for shorter time to allow retries
      cache.set(cacheKey, enhancedData, 5 * 60 * 1000);
    }

    res.json(enhancedData);
  } catch (err) {
    console.log("error in mediaInfo: ", err);

    // Send error response
    const errorResponse = {
      success: false,
      message: "Internal server error: " + (err instanceof Error ? err.message : String(err)),
    };
<<<<<<< HEAD
    
    // Cache the error response briefly to prevent retry storms.
    cache.set(cacheKey, errorResponse, MEDIAINFO_FAILURE_CACHE_TTL_MS);
    
=======

    // Cache the error response for a short time to prevent repeated error requests
    cache.set(cacheKey, errorResponse, 2 * 60 * 1000); // Cache error for 2 minutes

>>>>>>> 4b1fb64253e6d9d93dfed6a87f75e1e232681780
    res.status(500).json(errorResponse);
  }
}
