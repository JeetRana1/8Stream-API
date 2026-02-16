import axios from "axios";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function getVidSrcProStream(id: string) {
    try {
        const domain = "https://vidsrc.pro";
        const embedUrl = `${domain}/embed/movie/${id}`;

        console.log(`[VidSrcPro] Trying: ${embedUrl}`);

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": domain
        };

        try {
            const res = await axios.get(embedUrl, { headers, timeout: 8000 });
            // Look for the source in the script
            const videoRegex = /https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mkv|webm)[^\s"'<>]*\??[^\s"'<>]*/gi;
            const matches = res.data.match(videoRegex) || [];
            for (const v of matches) {
                if (v.includes('.m3u8') || v.includes('.mp4')) {
                    return {
                        success: true,
                        data: {
                            playlist: [{ title: "VidSrc Pro", file: v, folder: [] }],
                            key: "vidsrcpro_direct",
                            provider: "vidsrcpro"
                        }
                    };
                }
            }
        } catch { }

        return { success: false, message: "VidSrcPro: No direct stream found" };

    } catch (error: any) {
        return { success: false, message: `VidSrcPro Error: ${error.message}` };
    }
}
