import axios from "axios";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

/**
 * Embed.su Provider
 * High success rate in 2025
 */
export async function getEmbedSuStream(id: string) {
    try {
        const domain = "https://embed.su";
        const embedUrl = `${domain}/embed/movie/${id}`;

        console.log(`[EmbedSu] Trying: ${embedUrl}`);

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": domain,
            "Accept": "*/*"
        };

        const fetchWithFallback = async (url: string) => {
            try {
                return await axios.get(url, { headers, timeout: 8000 });
            } catch {
                return await axios.get(url, {
                    headers,
                    httpAgent: torAgent,
                    httpsAgent: torAgent,
                    timeout: 20000
                });
            }
        };

        const response = await fetchWithFallback(embedUrl);
        const body = response.data;

        // Embed.su often has its source in a packed script or JSON
        const m3u8Match = body.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
        if (m3u8Match) {
            console.log(`[EmbedSu] Found direct HLS: ${m3u8Match[0]}`);
            return {
                success: true,
                data: {
                    playlist: [{ title: "EmbedSu HD", file: m3u8Match[0], folder: [] }],
                    key: "embedsu_direct",
                    provider: "embedsu"
                }
            };
        }

        // Try to find a player data object
        const scriptData = body.match(/window\.playerData\s*=\s*({.*?});/s);
        if (scriptData) {
            try {
                const data = JSON.parse(scriptData[1]);
                if (data.file) {
                    return {
                        success: true,
                        data: {
                            playlist: [{ title: "EmbedSu Data", file: data.file, folder: [] }],
                            key: "embedsu_direct",
                            provider: "embedsu"
                        }
                    };
                }
            } catch { }
        }

        return { success: false, message: "EmbedSu: No direct stream found" };

    } catch (error: any) {
        return { success: false, message: `EmbedSu Error: ${error.message}` };
    }
}
