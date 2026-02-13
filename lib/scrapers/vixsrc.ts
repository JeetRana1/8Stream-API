import axios from 'axios';
import * as cheerio from 'cheerio';

export async function scrapeVixsrc(tmdbId: string, type: 'movie' | 'tv', season?: number, episode?: number) {
    try {
        const url = type === 'movie'
            ? `https://vixsrc.to/movie/${tmdbId}`
            : `https://vixsrc.to/tv/${tmdbId}/${season}/${episode}`;

        console.log(`[scrapeVixsrc] Fetching: ${url}`);
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Referer': 'https://google.com'
            }
        });

        const $ = cheerio.load(res.data);
        const scripts = $('script').toArray();
        let playlistData: any = null;

        for (const script of scripts) {
            const content = $(script).html() || '';
            if (content.includes('window.masterPlaylist')) {
                // Extract using regex - more flexible about the ending ;
                const match = content.match(/window\.masterPlaylist\s*=\s*({[\s\S]*?})(\s+window|\s*$|;)/);
                if (match && match[1]) {
                    try {
                        // Attempt to parse loosely
                        // Replace single quotes with double quotes and unquoted keys with quoted keys
                        const jsonStr = match[1]
                            .replace(/'/g, '"')
                            .replace(/(\s)(\w+):/g, '$1"$2":')
                            .replace(/,(\s*[}\]])/g, '$1');
                        playlistData = JSON.parse(jsonStr);
                    } catch (e) {
                        // Fallback: manual regex
                        const urlMatch = content.match(/url:\s*'([^']+)'/);
                        const tokenMatch = content.match(/'token':\s*'([^']+)'/);
                        const expiresMatch = content.match(/'expires':\s*'([^']+)'/);
                        if (urlMatch) {
                            playlistData = {
                                url: urlMatch[1],
                                params: {
                                    token: tokenMatch ? tokenMatch[1] : '',
                                    expires: expiresMatch ? expiresMatch[1] : ''
                                }
                            };
                        }
                    }
                    if (playlistData) break;
                }
            }
        }

        if (playlistData && playlistData.url) {
            const finalUrl = `${playlistData.url}?token=${playlistData.params.token}&expires=${playlistData.params.expires}`;
            return {
                success: true,
                streamUrl: finalUrl,
                proxyRef: url, // Pass referer separately
                embedUrl: url, // Fallback for 403s
                isEmbed: false // Direct manifest
            };
        }

        // If we reached here, we didn't find the master playlist. 
        // But the page exists (200 OK), so return the page itself as an embed.
        // This is much more reliable as the player handles iframes well.
        console.log(`[scrapeVixsrc] Falling back to embed URL for ${url}`);
        return {
            success: true,
            streamUrl: url,
            isEmbed: true,
            name: 'VixSrc'
        };
    } catch (e: any) {
        console.error(`[scrapeVixsrc] Error: ${e.message}`, e.response ? e.response.status : '');
        return { success: false, message: e.message };
    }
}
