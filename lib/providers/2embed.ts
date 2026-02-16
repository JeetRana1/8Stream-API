import axios from "axios";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export async function get2EmbedStream(id: string) {
    try {
        const cleanId = id.replace('tt', '');
        const isImdb = id.startsWith('tt');

        const domains = [
            'https://www.2embed.cc',
            'https://www.2embed.to'
        ];

        for (const domain of domains) {
            try {
                const embedUrl = isImdb
                    ? `${domain}/embed/${id}`
                    : `${domain}/embedtmdb/movie/${cleanId}`;

                console.log(`[2Embed] Trying: ${embedUrl}`);

                const response = await axios.get(embedUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": domain,
                    },
                    timeout: 8000
                });

                // 2Embed typically returns JSON with stream URLs
                if (response.data && typeof response.data === 'object') {
                    const streamUrl = response.data.url || response.data.stream || response.data.file;

                    if (streamUrl) {
                        console.log(`[2Embed] Found stream URL`);

                        return {
                            success: true,
                            data: {
                                playlist: [{
                                    title: "2Embed Stream",
                                    file: streamUrl,
                                    folder: []
                                }],
                                key: "",
                                provider: "2embed"
                            }
                        };
                    }
                }
            } catch (e: any) {
                console.log(`[2Embed] Failed ${domain}: ${e.message}`);
            }
        }

        return { success: false, message: "2Embed: No streams found" };
    } catch (error: any) {
        console.error(`[2Embed] Error:`, error.message);
        return { success: false, message: `2Embed Error: ${error.message}` };
    }
}
