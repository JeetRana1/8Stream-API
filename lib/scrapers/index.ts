import { resolveImdbToTmdb } from "../tmdbResolver";
import { scrapeVidsrc } from "./vidsrc";
import { scrapeVixsrc } from "./vixsrc";
import { scrapeVideasy } from "./videasy";

export async function scrapeAll(id: string, type: "movie" | "tv", season?: number, episode?: number) {
    const results: any[] = [];

    // 1. Try VidSrc (Primary)
    console.log(`[scrapeAll] Attempting VidSrc...`);
    try {
        const vidsrcResult = await scrapeVidsrc(id, type, season, episode, "https://vidsrc.net");
        if (vidsrcResult.success) results.push({ id: "vidsrc", source: "vidsrc.net", ...vidsrcResult });
    } catch (e) { }

    // 2. Try VidSrcMe (vidsrc-embed.ru)
    console.log(`[scrapeAll] Attempting VidSrcMe (ru)...`);
    try {
        const vidsrcMeResult = await scrapeVidsrc(id, type, season, episode, "https://vidsrc-embed.ru");
        if (vidsrcMeResult.success) results.push({ id: "vidsrcme", source: "vidsrcme.ru", ...vidsrcMeResult });
    } catch (e) { }

    // 2b. Try VidSrcMe Fallback (vidsrc-embed.su)
    console.log(`[scrapeAll] Attempting VidSrcMe (su)...`);
    try {
        const vidsrcMeSuResult = await scrapeVidsrc(id, type, season, episode, "https://vidsrc-embed.su");
        if (vidsrcMeSuResult.success) {
            // Only add if not already found (or add as separate source)
            if (!results.find(r => r.id === "vidsrcme")) {
                results.push({ id: "vidsrcme_su", source: "vidsrcme.su", ...vidsrcMeSuResult });
            }
        }
    } catch (e) { }

    // 3. Try VixSrc (REQUIRES TMDB ID)
    console.log(`[scrapeAll] Attempting VixSrc...`);
    try {
        let tmdbId = id;
        if (id.startsWith('tt')) {
            tmdbId = await resolveImdbToTmdb(id, type);
        }

        // Only try if we have a numeric ID (VixSrc doesn't support tt...)
        if (!tmdbId.startsWith('tt')) {
            const vixsrcResult = await scrapeVixsrc(tmdbId, type, season, episode);
            if (vixsrcResult.success) results.push({ id: "vixsrc", source: "vixsrc.to", ...vixsrcResult });
        } else {
            console.log(`[scrapeAll] Skipping VixSrc because could not resolve ${id} to TMDB ID`);
        }
    } catch (e) { }

    // 4. Try Videasy
    console.log(`[scrapeAll] Attempting Videasy...`);
    try {
        const videasyResult = await scrapeVideasy(id, type, season, episode);
        if (videasyResult.success) results.push({ id: "videasy", source: "videasy.net", ...videasyResult });
    } catch (e) { }

    // 5. Try VidSrc.pm
    console.log(`[scrapeAll] Attempting VidSrc.pm...`);
    try {
        const vidsrcPmResult = await scrapeVidsrc(id, type, season, episode, "https://vidsrc.pm");
        if (vidsrcPmResult.success) results.push({ id: "vidsrcpm", source: "vidsrc.pm", ...vidsrcPmResult });
    } catch (e) { }

    return results;
}
