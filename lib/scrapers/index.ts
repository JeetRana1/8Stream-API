import { scrapeVidsrc } from "./vidsrc";
import { scrapeVixsrc } from "./vixsrc";
import { scrapeVideasy } from "./videasy";

export async function scrapeAll(tmdbId: string, type: "movie" | "tv", season?: number, episode?: number) {
    const results: any[] = [];

    // 1. Try VidSrc (Primary)
    console.log(`[scrapeAll] Attempting VidSrc...`);
    try {
        const vidsrcResult = await scrapeVidsrc(tmdbId, type, season, episode, "https://vidsrc.net");
        if (vidsrcResult.success) results.push({ id: "vidsrc", source: "vidsrc.net", ...vidsrcResult });
    } catch (e) { }

    // 2. Try VidSrcMe
    console.log(`[scrapeAll] Attempting VidSrcMe...`);
    try {
        const vidsrcMeResult = await scrapeVidsrc(tmdbId, type, season, episode, "https://vidsrc-embed.ru");
        if (vidsrcMeResult.success) results.push({ id: "vidsrcme", source: "vidsrcme.ru", ...vidsrcMeResult });
    } catch (e) { }

    // 3. Try VixSrc
    console.log(`[scrapeAll] Attempting VixSrc...`);
    try {
        const vixsrcResult = await scrapeVixsrc(tmdbId, type, season, episode);
        if (vixsrcResult.success) results.push({ id: "vixsrc", source: "vixsrc.to", ...vixsrcResult });
    } catch (e) { }

    // 4. Try Videasy
    console.log(`[scrapeAll] Attempting Videasy...`);
    try {
        const videasyResult = await scrapeVideasy(tmdbId, type, season, episode);
        if (videasyResult.success) results.push({ id: "videasy", source: "videasy.net", ...videasyResult });
    } catch (e) { }

    // 5. Try VidSrc.pm
    console.log(`[scrapeAll] Attempting VidSrc.pm...`);
    try {
        const vidsrcPmResult = await scrapeVidsrc(tmdbId, type, season, episode, "https://vidsrc.pm");
        if (vidsrcPmResult.success) results.push({ id: "vidsrcpm", source: "vidsrc.pm", ...vidsrcPmResult });
    } catch (e) { }

    return results;
}
