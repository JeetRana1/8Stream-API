import { Request, Response } from "express";
import getInfo from "../lib/getInfo";
import { resolveTmdbToImdb } from "../lib/tmdbResolver";
import cache from "../lib/cache";
import { scrapeAll } from "../lib/scrapers";

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

    // Cache the error response for a short time to prevent repeated error requests
    cache.set(cacheKey, errorResponse, 2 * 60 * 1000); // Cache error for 2 minutes

    res.status(500).json(errorResponse);
  }
}