import { Request, Response } from "express";
import getInfo from "../lib/getInfo";
import { resolveTmdbToImdb } from "../lib/tmdbResolver";
import { getMapplUrl } from "../lib/mappl";
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
      // Trigger scrapers for the resolved ID (works for both TMDB and IMDB)
      const { scrapeAll } = require("../lib/scrapers");
      extraSources = await scrapeAll(
        finalId,
        (type as any) || 'movie',
        s ? parseInt(s as string) : undefined,
        e ? parseInt(e as string) : undefined
      );
    } catch (e) {
      console.error("[mediaInfo] New scrapers failed:", e);
    }

    // Generate Mappl URL as an additional source
    const mapplUrl = getMapplUrl(
      finalId,
      (type as any) || 'movie',
      s ? parseInt(s as string) : undefined,
      e ? parseInt(e as string) : undefined
    );

    // Combine data
    const enhancedData = {
      ...data,
      mappl: mapplUrl,
      extraSources: extraSources,
      source: "8stream"
    };

    console.log(`Response data (enhanced):`, {
      success: enhancedData.success,
      extraSourcesCount: extraSources.length
    });

    // Cache the result if successful or if we have extra sources
    if (data.success || extraSources.length > 0) {
      enhancedData.success = true; // Mark as success if we found anything
      cache.set(cacheKey, enhancedData, 30 * 60 * 1000);
    } else {
      // Even if primary source fails, return mappl as a backup
      const backupData = {
        success: true,
        data: {
          playlist: [],
          key: ""
        },
        mappl: mapplUrl,
        extraSources: [],
        source: "mappl.tv"
      };
      cache.set(cacheKey, backupData, 5 * 60 * 1000);
      return res.json(backupData);
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