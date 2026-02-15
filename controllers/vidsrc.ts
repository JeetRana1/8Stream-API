import { Request, Response } from "express";
import { scrapeVidSrc } from "../lib/vidsrcResolver";
import cache from "../lib/cache";

export default async function vidsrcController(req: Request, res: Response) {
    const tmdb_id = req.query.tmdb_id as string;
    const type = (req.query.type as "movie" | "tv") || "movie";
    const season = req.query.season ? parseInt(req.query.season as string) : undefined;
    const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;

    if (!tmdb_id) {
        return res.status(400).json({
            success: false,
            error: "tmdb_id query param is required",
        });
    }

    if (type === "tv" && (season === undefined || episode === undefined)) {
        return res.status(400).json({
            success: false,
            error: "season and episode query params are required for TV shows",
        });
    }

    const cacheKey = `vidsrc_${tmdb_id}_${type}_${season || 0}_${episode || 0}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log(`[vidsrc] Serving from cache for ${tmdb_id}`);
        return res.json(cached);
    }

    try {
        const results = await scrapeVidSrc(tmdb_id, type, season, episode);

        // Find at least one successful result
        const firstSuccessful = Object.values(results).find(r => r.hls_url);

        const response = {
            success: !!firstSuccessful,
            results,
            // Provide a simplified main result if successful
            data: firstSuccessful ? {
                hls_url: firstSuccessful.hls_url,
                subtitles: firstSuccessful.subtitles
            } : null
        };

        // Cache the result for 30 minutes
        cache.set(cacheKey, response, 30 * 60 * 1000);

        res.json(response);
    } catch (err: any) {
        console.error(`[vidsrc] Unexpected error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: "Unexpected server error",
            message: err.message
        });
    }
}
