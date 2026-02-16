import axios from "axios";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function getSmashyStreamStream(id: string) {
    try {
        const isImdb = id.startsWith('tt');

        // Smashystream API endpoints
        const apiUrl = isImdb
            ? `https://embed.smashystream.com/playere.php?imdb=${id}`
            : `https://embed.smashystream.com/playere.php?tmdb=${id}`;

        console.log(`[Smashystream] Trying: ${apiUrl}`);

        try {
            const response = await axios.get(apiUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://smashystream.com/",
                },
                timeout: 10000
            });

            // Look for m3u8 URLs in the response
            const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

            // Try to find HLS manifest URL
            const m3u8Match = responseText.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"']*/);
            if (m3u8Match) {
                console.log(`[Smashystream] Found HLS URL: ${m3u8Match[0]}`);
                return {
                    success: true,
                    data: {
                        playlist: [{
                            title: "Smashystream",
                            file: m3u8Match[0],
                            folder: []
                        }],
                        key: "",
                        provider: "smashystream"
                    }
                };
            }

            // Look for source/file URLs in JSON
            const sourceMatch = responseText.match(/["']?(?:source|file|src|url)["']?\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);
            if (sourceMatch && sourceMatch[1]) {
                console.log(`[Smashystream] Found source URL: ${sourceMatch[1]}`);
                return {
                    success: true,
                    data: {
                        playlist: [{
                            title: "Smashystream",
                            file: sourceMatch[1],
                            folder: []
                        }],
                        key: "",
                        provider: "smashystream"
                    }
                };
            }

            console.log(`[Smashystream] No HLS URL found in response`);
        } catch (e: any) {
            console.log(`[Smashystream] Request failed: ${e.message}`);
        }

        return { success: false, message: "Smashystream: No streams found" };
    } catch (error: any) {
        console.error(`[Smashystream] Error:`, error.message);
        return { success: false, message: `Smashystream Error: ${error.message}` };
    }
}
