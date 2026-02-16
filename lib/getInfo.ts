import getAllMovieLandStream from "./providers/allmovieland";
import { getVidSrcStream } from "./providers/vidsrc";

/**
 * Multi-provider stream resolver
 * Tries providers in order until one succeeds
 */
export default async function getInfo(id: string) {
    console.log(`[getInfo] Searching for streams for ID: ${id}`);

    // Define provider priority order
    // AllMovieLand first (primary provider)
    // Then fallback to VidSrc
    const providers = [
        { name: "AllMovieLand", fn: getAllMovieLandStream },
        { name: "VidSrc", fn: getVidSrcStream }
    ];

    const errors: string[] = [];

    for (const provider of providers) {
        try {
            console.log(`[getInfo] Trying provider: ${provider.name}`);
            const result = await provider.fn(id);

            if (result.success && result.data?.playlist && result.data.playlist.length > 0) {
                console.log(`[getInfo] ✓ ${provider.name} found ${result.data.playlist.length} stream(s)`);
                return result;
            } else {
                const msg = result.message || "No streams found";
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
        message: `No streams found from any provider. Errors: ${errors.join(' | ')}`
    };
}
