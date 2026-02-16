import getAllMovieLandStream from "./providers/allmovieland";
import { getVidSrcStream } from "./providers/vidsrc";
import { getVidSrcProStream } from "./providers/vidsrcpro";
import { getAutoEmbedStream } from "./providers/autoembed";
import { getMultiEmbedStream } from "./providers/multiembed";
import { getEmbedSuStream } from "./providers/embedsu";

/**
 * Multi-provider stream resolver
 * Tries providers in order until one succeeds
 */
export default async function getInfo(id: string) {
    console.log(`[getInfo] Searching for streams for ID: ${id}`);

    // Define provider priority order based on 2025 reliability
    const providers = [
        { name: "AllMovieLand", fn: getAllMovieLandStream },
        { name: "EmbedSu", fn: getEmbedSuStream },
        { name: "VidSrc", fn: getVidSrcStream },
        { name: "VidSrcPro", fn: getVidSrcProStream },
        { name: "MultiEmbed", fn: getMultiEmbedStream },
        { name: "AutoEmbed", fn: getAutoEmbedStream }
    ];

    const errors: string[] = [];

    for (const provider of providers) {
        try {
            console.log(`[getInfo] Trying provider: ${provider.name}`);
            const result: any = await provider.fn(id);

            if (result.success && result.data?.playlist && result.data.playlist.length > 0) {
                console.log(`[getInfo] ✓ ${provider.name} found ${result.data.playlist.length} stream(s)`);
                return result;
            } else {
                const msg = result.message || "No direct streams found";
                console.log(`[getInfo] ✗ ${provider.name}: ${msg}`);
                errors.push(`${provider.name}: ${msg}`);
            }
        } catch (error: any) {
            const msg = error.message || "Unknown error";
            console.error(`[getInfo] ✗ ${provider.name} threw error: ${msg}`);
            errors.push(`${provider.name}: ${msg}`);
        }
    }

    // All providers failed
    console.error(`[getInfo] All providers failed for ID: ${id}`);
    return {
        success: false,
        message: `No active streams found. Checked 6 providers. Errors: ${errors.join(' | ')}`
    };
}
