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
            const m3u8Match = res.data.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
            if (m3u8Match) {
                return {
                    success: true,
                    data: {
                        playlist: [{ title: "VidSrc Pro", file: m3u8Match[0], folder: [] }],
                        key: "vidsrcpro_direct",
                        provider: "vidsrcpro"
                    }
                };
            }
        } catch { }

        // Fallback to embed URL
        return {
            success: true,
            data: {
                playlist: [{ title: "VidSrc Pro Player", file: embedUrl, folder: [] }],
                key: "vidsrcpro_embed",
                provider: "vidsrcpro"
            }
        };

    } catch (error: any) {
        return { success: false, message: `VidSrcPro Error: ${error.message}` };
    }
}
