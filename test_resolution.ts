
import { resolveImdbToTmdb } from "./lib/tmdbResolver";
import { scrapeVixsrc } from "./lib/scrapers/vixsrc";
import { scrapeVidsrc } from "./lib/scrapers/vidsrc";

async function test() {
    console.log("--- Testing ID Resolution ---");
    const imdbId = "tt7587890"; // The Rookie
    console.log(`Resolving ${imdbId}...`);
    try {
        const tmdbId = await resolveImdbToTmdb(imdbId, "tv");
        console.log(`Result: ${tmdbId}`);

        if (tmdbId === "79744") {
            console.log("MATCH! Resolution works via scraping.");
        } else if (tmdbId === imdbId) {
            console.log("FAILURE! Returned original ID. Scraping fallback failed.");
        } else {
            console.log(`Unexpected result: ${tmdbId}`);
        }

        if (tmdbId !== imdbId) {
            console.log("\n--- Testing VixSrc Scraper ---");
            console.log(`Scraping VixSrc with ID ${tmdbId}...`);
            const vixRes = await scrapeVixsrc(tmdbId, "tv", 1, 1);
            console.log("VixSrc Result:", vixRes);
        }

    } catch (e: any) {
        console.error("Resolution Error:", e.message);
    }

    console.log("\n--- Testing VidSrc.net (Primary) ---");
    const vidsrcNet = await scrapeVidsrc(imdbId, "tv", 1, 1, "https://vidsrc.net");
    console.log("VidSrc.net:", vidsrcNet.success, vidsrcNet.message);
    if (vidsrcNet.success) console.log("Stream URL:", vidsrcNet.streamUrl);

    console.log("\n--- Testing VidSrcMe (RU) ---");
    const vidsrcRu = await scrapeVidsrc(imdbId, "tv", 1, 1, "https://vidsrc-embed.ru");
    console.log("VidSrcMe RU:", vidsrcRu.success, vidsrcRu.message);

    console.log("\n--- Testing VidSrcMe (SU) ---");
    const vidsrcSu = await scrapeVidsrc(imdbId, "tv", 1, 1, "https://vidsrc-embed.su");
    console.log("VidSrcMe SU:", vidsrcSu.success, vidsrcSu.message);
}

test();
