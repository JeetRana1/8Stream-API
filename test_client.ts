
import axios from "axios";

async function main() {
    const id = "tt33028778";

    console.log(`[CLIENT TEST] Fetching media info for ${id} from local API...`);
    try {
        const response = await axios.get(`http://localhost:7860/api/v1/mediaInfo?id=${id}`);
        console.log(`[CLIENT TEST] Status: ${response.status}`);

        const data = response.data;
        if (data.success) {
            console.log("[CLIENT TEST] Success! Primary source found.");
            // console.log("Playlist:", JSON.stringify(data.data.playlist, null, 2));

            // Test scraper results too
            console.log(`[CLIENT TEST] Extra Sources Found: ${data.extraSources?.length || 0}`);
            if (data.extraSources) {
                data.extraSources.forEach((s: any) => {
                    console.log(` - ${s.id}: ${s.name} (${s.streamUrl})`);
                    if (s.streamUrl.includes('cloudnestra') || s.streamUrl.includes('protection-episode')) {
                        console.error(`   [FAIL] Blacklisted domain found in source: ${s.id}`);
                    }
                });
            }

        } else {
            console.log("[CLIENT TEST] Failed:", data.message);
        }

    } catch (e: any) {
        console.error(`[CLIENT TEST] Error: ${e.message}`, e.response?.data);
    }
}

main();
