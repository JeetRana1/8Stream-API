import { chromium, Browser, BrowserContext } from "playwright";
import pLimit from "p-limit";
import { resolveTmdbToImdb } from "./tmdbResolver";

const PROVIDERS = [
    "https://vidsrc.to",
    "https://vidsrc.me",
    "https://vidsrc.xyz",
    "https://vidsrc.in",
    "https://vidsrc.net",
    "https://vidsrc.pm",
];

const limit = pLimit(2);

interface ScrapeResult {
    hls_url: string | null;
    subtitles: string[];
    error: string | null;
}

export async function scrapeVidSrc(tmdbId: string, type: "movie" | "tv" = "movie", season?: number, episode?: number): Promise<Record<string, ScrapeResult>> {
    // Resolve IDs
    let imdbId = tmdbId;
    const resolvedId = await resolveTmdbToImdb(tmdbId, type);

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const urls = PROVIDERS.reduce((acc, domain) => {
            // Use resolved ID (IMDb) for .to and .me, others might prefer TMDB
            const useId = (domain.includes(".to") || domain.includes(".me")) ? resolvedId : tmdbId;
            acc[domain] =
                type === "tv"
                    ? `${domain}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`
                    : `${domain}/embed/movie/${useId}`;
            return acc;
        }, {} as Record<string, string>);

        const resultsArr: Array<[string, ScrapeResult]> = await Promise.all(
            Object.entries(urls).map(([domain, url]) =>
                limit(async (): Promise<[string, ScrapeResult]> => {
                    let context: BrowserContext | null = null;
                    try {
                        console.log(`\n[${domain}] Starting scrape for URL: ${url}`);
                        context = await browser.newContext({
                            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                            ignoreHTTPSErrors: true,
                        });
                        const page = await context.newPage();

                        let hlsUrl: string | null = null;
                        const subtitles: string[] = [];

                        const isSubtitle = (url: string) => {
                            return /\.(vtt|srt)(\?.*)?$/.test(url) || url.includes(".vtt") || url.includes(".srt");
                        };

                        // Intercept requests
                        await page.route("**/*", (route) => {
                            const reqUrl = route.request().url();
                            if (!hlsUrl && reqUrl.includes(".m3u8")) {
                                hlsUrl = reqUrl;
                                console.log(`[${domain}] Found HLS URL: ${hlsUrl}`);
                            }
                            if (isSubtitle(reqUrl) && !subtitles.includes(reqUrl)) {
                                subtitles.push(reqUrl);
                                console.log(`[${domain}] Found subtitle URL: ${reqUrl}`);
                            }
                            route.continue();
                        });

                        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
                        console.log(`[${domain}] Page loaded`);

                        // Remove common ad overlays
                        await page.evaluate(() => {
                            const selectors = ['.vidsrc-ads', '.ad-overlay', '#video-overlay', 'div[class*="ad-"]'];
                            selectors.forEach(sel => {
                                document.querySelectorAll(sel).forEach(el => el.remove());
                            });
                        });

                        const frameSelector = "#the_frame";
                        const frameDiv = await page.waitForSelector(frameSelector, { timeout: 10000 }).catch(() => null);

                        if (frameDiv) {
                            console.log(`[${domain}] Found #the_frame`);
                            const box = await frameDiv.boundingBox();
                            if (box) {
                                const clickX = box.x + box.width / 2;
                                const clickY = box.y + box.height / 2;
                                console.log(`[${domain}] Clicking at (${clickX}, ${clickY})`);
                                await page.mouse.move(clickX, clickY);
                                await page.mouse.click(clickX, clickY);
                            } else {
                                console.warn(`[${domain}] Clicking via evaluateFallback`);
                                await page.evaluate((sel) => {
                                    (document.querySelector(sel) as HTMLElement)?.click();
                                }, frameSelector);
                            }

                            // Give time for network requests
                            await page.waitForTimeout(7000);

                            if (!hlsUrl) {
                                console.log(`[${domain}] Waiting for .m3u8 response (last chance)...`);
                                await page.waitForResponse((resp) => resp.url().includes(".m3u8"), { timeout: 10000 }).catch(() => {
                                    console.warn(`[${domain}] .m3u8 not detected`);
                                });
                            }
                        } else {
                            console.warn(`[${domain}] #the_frame not found, trying center click`);
                            const width = page.viewportSize()?.width || 1280;
                            const height = page.viewportSize()?.height || 720;
                            await page.mouse.click(width / 2, height / 2);
                            await page.waitForTimeout(7000);
                        }

                        if (subtitles.length === 0) {
                            await page.waitForTimeout(5000);
                        }

                        if (!hlsUrl) throw new Error("HLS URL not found");

                        return [domain, { hls_url: hlsUrl, subtitles, error: null }];
                    } catch (err: any) {
                        console.error(`[${domain}] Error: ${err.message}`);
                        return [domain, { hls_url: null, subtitles: [], error: err.message }];
                    } finally {
                        if (context) await context.close();
                    }
                })
            )
        );

        return Object.fromEntries(resultsArr);
    } finally {
        await browser.close();
    }
}
