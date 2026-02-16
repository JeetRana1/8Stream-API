import axios from "axios";
import * as cheerio from "cheerio";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function getVidSrcStream(id: string) {
    try {
        // VidSrc supports both IMDB IDs (tt...) and TMDB IDs
        const cleanId = id.replace('tt', '');
        const isImdb = id.startsWith('tt');

        // VidSrc has multiple domains
        const domains = [
            'https://vidsrc.to',
            'https://vidsrc.me',
            'https://vidsrc.net'
        ];

        for (const domain of domains) {
            try {
                const embedUrl = isImdb
                    ? `${domain}/embed/movie/${id}`
                    : `${domain}/embed/movie/tmdb/${cleanId}`;

                console.log(`[VidSrc] Trying: ${embedUrl}`);

                const response = await axios.get(embedUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": domain,
                    },
                    timeout: 8000
                });

                const $ = cheerio.load(response.data);

                // VidSrc typically has iframe with data-src or src
                const iframe = $('iframe[data-src], iframe[src]').first();
                const streamUrl = iframe.attr('data-src') || iframe.attr('src');

                if (streamUrl) {
                    console.log(`[VidSrc] Found stream URL: ${streamUrl}`);

                    return {
                        success: true,
                        data: {
                            playlist: [{
                                title: "VidSrc Stream",
                                file: streamUrl.startsWith('http') ? streamUrl : `${domain}${streamUrl}`,
                                folder: []
                            }],
                            key: "",
                            provider: "vidsrc"
                        }
                    };
                }
            } catch (e: any) {
                console.log(`[VidSrc] Failed ${domain}: ${e.message}`);
            }
        }

        return { success: false, message: "VidSrc: No streams found" };
    } catch (error: any) {
        console.error(`[VidSrc] Error:`, error.message);
        return { success: false, message: `VidSrc Error: ${error.message}` };
    }
}
