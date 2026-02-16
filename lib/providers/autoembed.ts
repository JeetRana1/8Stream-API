import axios from "axios";
import * as cheerio from "cheerio";
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

        // AutoEmbed is hard to extract direct M3U8 from as it's an aggregator.
        // But we can check if it has any obvious direct links.
        const m3u8Match = body.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
        if (m3u8Match) {
            console.log(`[AutoEmbed] Found direct HLS: ${m3u8Match[0]}`);
            return {
                success: true,
                data: {
                    playlist: [{ title: "AutoEmbed Stream", file: m3u8Match[0], folder: [] }],
                    key: "autoembed_direct",
                    provider: "autoembed"
                }
            };
        }

        // If no direct link, return the embed URL
        // AutoEmbed works well in an iframe
        return {
            success: true,
            data: {
                playlist: [{ title: "AutoEmbed Player", file: embedUrl, folder: [] }],
                key: "autoembed_embed",
                provider: "autoembed"
            }
        };

    } catch (error: any) {
        console.error(`[AutoEmbed] Error:`, error.message);
        return { success: false, message: `AutoEmbed Error: ${error.message}` };
    }
}
