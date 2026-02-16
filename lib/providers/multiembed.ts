import axios from "axios";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function getMultiEmbedStream(id: string) {
    try {
        const domain = "https://multiembed.mov";
        const embedUrl = `${domain}/?video_id=${id}`;

        console.log(`[MultiEmbed] Trying: ${embedUrl}`);

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": domain
        };

        try {
            const res = await axios.get(embedUrl, { headers, timeout: 8000 });
            // Look for m3u8 in the response
            const m3u8Match = res.data.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
            if (m3u8Match) {
                return {
                    success: true,
                    data: {
                        playlist: [{ title: "MultiEmbed Stream", file: m3u8Match[0], folder: [] }],
                        key: "multiembed_direct",
                        provider: "multiembed"
                    }
                };
            }
        } catch { }

        // Fallback to embed URL
        return {
            success: true,
            data: {
                playlist: [{ title: "MultiEmbed Player", file: embedUrl, folder: [] }],
                key: "multiembed_embed",
                provider: "multiembed"
            }
        };

    } catch (error: any) {
        return { success: false, message: `MultiEmbed Error: ${error.message}` };
    }
}
