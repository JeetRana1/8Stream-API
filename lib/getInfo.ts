import getAllMovieLandStream from "./providers/allmovieland";

/**
 * Stream resolver using AllMovieLand provider
 */
export default async function getInfo(id: string) {
    console.log(`[getInfo] Searching for streams for ID: ${id}`);

    try {
        const result = await getAllMovieLandStream(id);

        if (result.success && result.data?.playlist && result.data.playlist.length > 0) {
            console.log(`[getInfo] ✓ AllMovieLand found ${result.data.playlist.length} stream(s)`);
            return result;
        } else {
            const msg = result.message || "No streams found";
            console.log(`[getInfo] ✗ AllMovieLand: ${msg}`);
            return {
                success: false,
                message: `AllMovieLand: ${msg}`
            };
        }
    } catch (error: any) {
        const msg = error.message || "Unknown error";
        console.error(`[getInfo] ✗ AllMovieLand threw error: ${msg}`);
        return {
            success: false,
            message: `AllMovieLand Error: ${msg}`
        };
    }
}
