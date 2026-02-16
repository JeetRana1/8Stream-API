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
            const videoRegex = /https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mkv|webm)[^\s"'<>]*\??[^\s"'<>]*/gi;
            const matches = res.data.match(videoRegex) || [];
            for (const v of matches) {
                if (v.includes('.m3u8') || v.includes('.mp4')) {
                    return {
                        success: true,
                        data: {
                            playlist: [{ title: "MultiEmbed Stream", file: v, folder: [] }],
                            key: "multiembed_direct",
                            provider: "multiembed"
                        }
                    };
                }
            }
        } catch { }

        return { success: false, message: "MultiEmbed: No direct stream found" };

    } catch (error: any) {
        return { success: false, message: `MultiEmbed Error: ${error.message}` };
    }
}
