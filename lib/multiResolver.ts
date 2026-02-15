import { chromium, Browser, BrowserContext } from "playwright";
import pLimit from "p-limit";
import { resolveTmdbToImdb } from "./tmdbResolver";

const PROVIDERS = [
    { name: "VidSrc.me", url: "https://vidsrcme.ru", type: "vidsrc" },
    { name: "VidSrc.to", url: "https://vidsrc.to", type: "vidsrc" },
    { name: "VidSrc.xyz", url: "https://vidsrc.xyz", type: "vidsrc" },
    { name: "VidLink", url: "https://vidlink.pro", type: "vidlink" },
    { name: "Vidsrc.cc", url: "https://vidsrc.cc", type: "vidsrc" },
    { name: "FlixHQ", url: "https://flixhq.to", type: "movie_site" },
    { name: "SFlix", url: "https://sflix.to", type: "movie_site" },
    { name: "Cineb", url: "https://cineb.rs", type: "movie_site" },
    { name: "MoviesJoy", url: "https://moviesjoy.is", type: "movie_site" },
    { name: "HiMovies", url: "https://himovies.to", type: "movie_site" },
];

const limit = pLimit(2);

export interface ScrapeResult {
    video_url: string | null;
    subtitles: { lang: string; url: string }[];
    error: string | null;
    source: string;
    provider: string;
}

export async function scrapeMulti(tmdbId: string, type: "movie" | "tv" = "movie", season?: number, episode?: number): Promise<ScrapeResult[]> {
    const imdbId = await resolveTmdbToImdb(tmdbId, type);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const results: ScrapeResult[] = [];

        async function scrapeProvider(provider: typeof PROVIDERS[0]) {
            let context: BrowserContext | null = null;
            try {
                context = await browser.newContext({
                    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    ignoreHTTPSErrors: true,
                });
                const page = await context.newPage();

                let videoUrl: string | null = null;
                const subtitles: { lang: string; url: string }[] = [];

                let targetUrl = "";
                if (provider.type === "vidsrc") {
                    targetUrl = type === "tv"
                        ? `${provider.url}/embed/tv/${imdbId}/${season}/${episode}`
                        : `${provider.url}/embed/movie/${imdbId}`;
                } else if (provider.type === "vidlink") {
                    targetUrl = type === "tv"
                        ? `${provider.url}/embed/tv/${tmdbId}/${season}/${episode}`
                        : `${provider.url}/embed/movie/${tmdbId}`;
                } else if (provider.type === "movie_site") {
                    // Try to guess embed URL for movie sites (flixhq etc)
                    // These often follow a pattern: /embed-movie/ID or similar
                    // Constructing common embed aliases
                    const siteId = provider.name.toLowerCase();
                    if (siteId === "flixhq") {
                        targetUrl = type === "tv" ? `${provider.url}/tv/${imdbId}/${season}/${episode}` : `${provider.url}/movie/${imdbId}`;
                    } else {
                        targetUrl = type === "tv" ? `${provider.url}/embed/tv/${tmdbId}/${season}/${episode}` : `${provider.url}/embed/movie/${tmdbId}`;
                    }
                }

                if (!targetUrl) return;

                console.log(`\n[${provider.name}] Scraping: ${targetUrl}`);

                // Intercept requests
                await page.route("**/*", (route) => {
                    const reqUrl = route.request().url();
                    // Broad video detection
                    const isVideo = (url: string) =>
                        url.includes(".m3u8") ||
                        (url.includes(".mp4") && !url.includes("ads") && !url.includes("pixel")) ||
                        url.includes("/playlist/") ||
                        url.includes("/stream/");

                    const isSubtitle = (url: string) =>
                        /\.(vtt|srt)(\?.*)?$/.test(url) ||
                        url.includes(".vtt") ||
                        url.includes(".srt");

                    if (!videoUrl && isVideo(reqUrl)) {
                        videoUrl = reqUrl;
                        console.log(`[${provider.name}] Found Video URL: ${videoUrl}`);
                    }
                    if (isSubtitle(reqUrl)) {
                        const langMatch = reqUrl.match(/lang=([^&]+)/) || reqUrl.match(/\/([a-z]{2})\.(vtt|srt)/i);
                        const lang = langMatch ? langMatch[1] : `sub_${subtitles.length}`;
                        if (!subtitles.find(s => s.url === reqUrl)) {
                            subtitles.push({ lang, url: reqUrl });
                        }
                    }
                    route.continue();
                });

                // Set a shorter timeout for the page load but longer for the extraction
                await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {
                    console.log(`[${provider.name}] domcontentloaded timeout, continuing...`);
                });

                // Remove ads that might block clicks
                await page.evaluate(() => {
                    const ads = document.querySelectorAll('.ad-unit, .vidsrc-ads, [id*="ad-"], [class*="ad-"]');
                    ads.forEach(a => a.remove());
                });

                // Click everywhere logic - sometimes it's an overlay
                const playerSelectors = [
                    "#the_frame", "#vidsrc-embed", "#player_iframe",
                    ".vidsrc-embed", ".player-container", "iframe[src*='embed']",
                    "div.play-button", "button.vjs-big-play-button"
                ];

                let foundPlayer = false;
                for (const selector of playerSelectors) {
                    const el = await page.waitForSelector(selector, { timeout: 3000 }).catch(() => null);
                    if (el) {
                        await el.scrollIntoViewIfNeeded().catch(() => { });
                        const box = await el.boundingBox();
                        if (box) {
                            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => { });
                        } else {
                            await el.click({ force: true }).catch(() => { });
                        }
                        foundPlayer = true;
                        // Don't break, try multiple if they exist
                    }
                }

                if (!foundPlayer) {
                    await page.mouse.click(640, 360).catch(() => { });
                }

                // Final wait for network activity to settle and video to start loading
                let success = false;
                for (let i = 0; i < 15; i++) {
                    if (videoUrl) {
                        success = true;
                        break;
                    }

                    // Recursive search in all iframes
                    const frames = page.frames();
                    for (const frame of frames) {
                        const frameUrl = frame.url();
                        if (!videoUrl && (frameUrl.includes(".m3u8") || frameUrl.includes(".mp4"))) {
                            videoUrl = frameUrl;
                            break;
                        }
                    }

                    if (!videoUrl) {
                        videoUrl = await page.evaluate(() => {
                            const findVideo = (doc: Document): string | null => {
                                const video = doc.querySelector('video');
                                if (video && video.src && video.src.startsWith('http')) return video.src;

                                const source = doc.querySelector('source');
                                if (source && (source as HTMLSourceElement).src && (source as HTMLSourceElement).src.startsWith('http')) return (source as HTMLSourceElement).src;

                                const scripts = Array.from(doc.querySelectorAll('script'));
                                for (const script of scripts) {
                                    const match = script.textContent?.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
                                    if (match) return match[1];
                                }
                                return null;
                            };
                            return findVideo(document);
                        }).catch(() => null);
                    }

                    await page.waitForTimeout(2000);
                }

                if (videoUrl) {
                    results.push({
                        video_url: videoUrl,
                        subtitles,
                        error: null,
                        source: targetUrl,
                        provider: provider.name
                    });
                } else {
                    // Try one last desperate search in the page source for signatures
                    const content = await page.content();
                    const m3u8Match = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
                    if (m3u8Match) {
                        videoUrl = m3u8Match[1];
                        console.log(`[${provider.name}] Found URL in Source: ${videoUrl}`);
                        results.push({
                            video_url: videoUrl,
                            subtitles,
                            error: null,
                            source: targetUrl,
                            provider: provider.name
                        });
                    }
                }

            } catch (err: any) {
                console.error(`[${provider.name}] Critical Error: ${err.message}`);
            } finally {
                if (context) await context.close();
            }
        }

        // Run in parallel with a strict limit
        await Promise.all(PROVIDERS.map(p => limit(() => scrapeProvider(p))));

        return results;
    } finally {
        await browser.close();
    }
}
