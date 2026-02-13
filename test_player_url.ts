
import { getPlayerUrl } from "./lib/getPlayerUrl";

async function main() {
    console.log("Testing getPlayerUrl...");
    try {
        const url = await getPlayerUrl();
        console.log("Returned URL:", url);
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
