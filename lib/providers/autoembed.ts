import axios from "axios";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

/**
 * AutoEmbed Provider
 * Very stable aggregator
 */
export async function getAutoEmbedStream(id: string) {
    try {
        const domain = "https://player.autoembed.cc";
        const embedUrl = `${domain}/embed/movie/${id}`;

        console.log(`[AutoEmbed] Trying: ${embedUrl}`);

        const fetchWithFallback = async (url: string) => {
            const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": domain
            };
            try {
                return await axios.get(url, { headers, timeout: 8000 });
            } catch (err: any) {
                console.log(`[AutoEmbed] Direct failed, trying Tor for ${url}`);
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

        const videoRegex = /https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mkv|webm)[^\s"'<>]*\??[^\s"'<>]*/gi;
        const matches = body.match(videoRegex) || [];
        for (const v of matches) {
            if (v.includes('.m3u8') || v.includes('.mp4')) {
                console.log(`[AutoEmbed] Found direct link: ${v}`);
                return {
                    success: true,
                    data: {
                        playlist: [{ title: "AutoEmbed Stream", file: v, folder: [] }],
                        key: "autoembed_direct",
                        provider: "autoembed"
                    }
                };
            }
        }

        return { success: false, message: "AutoEmbed: No direct stream found" };

    } catch (error: any) {
        console.error(`[AutoEmbed] Error:`, error.message);
        return { success: false, message: `AutoEmbed Error: ${error.message}` };
    }
}
