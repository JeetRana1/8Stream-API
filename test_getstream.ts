
import axios from "axios";

async function main() {
    console.log("[TEST] Testing /getStream endpoint...");

    const file = "~7c7UjDO0UmmvKNnKsbpisW3IJU+wF6hOniOt+AnEjk4hTTt8YA86Q-hagreEIbqix9OJjLzOwWS3MRxLghLfJ";
    const key = "1515099b3f1a934fa6156cd8fca4cf2f";

    try {
        const response = await axios.post("http://localhost:7860/api/v1/getStream", {
            file,
            key
        });

        console.log("[TEST] Status:", response.status);
        console.log("[TEST] Response:", JSON.stringify(response.data, null, 2));
    } catch (e: any) {
        console.error("[TEST] Error:", e.message);
        if (e.response) {
            console.error("[TEST] Response status:", e.response.status);
            console.error("[TEST] Response data:", e.response.data);
        }
    }
}

main();
