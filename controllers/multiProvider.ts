import { Request, Response } from "express";
import { scrapeMulti, ScrapeResult } from "../lib/multiResolver";
import cache from "../lib/cache";

export default async function multiProviderController(req: Request, res: Response) {
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

    const cacheKey = `multi_${tmdb_id}_${type}_${season || 0}_${episode || 0}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log(`[multi] Serving from cache for ${tmdb_id}`);
        return res.json(cached);
    }

    try {
        const results = await scrapeMulti(tmdb_id, type, season, episode);

        const host = req.get('host');
        const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
        const proxyBase = `${protocol}://${host}/api/v1/proxy?url=`;

        const proxiedResults = results.map(r => ({
            ...r,
            video_url: `${proxyBase}${encodeURIComponent(r.video_url!)}&proxy_ref=${encodeURIComponent(r.source || r.video_url!)}`
        }));

        const response = {
            success: proxiedResults.length > 0,
            results: proxiedResults,
            // Provide a primary result (prefer VidSrc or first successful)
            data: proxiedResults.length > 0 ? proxiedResults[0] : null
        };

        // Cache for 30 minutes
        cache.set(cacheKey, response, 30 * 60 * 1000);

        res.json(response);
    } catch (err: any) {
        console.error(`[multi] Unexpected error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: "Unexpected server error",
            message: err.message
        });
    }
}
