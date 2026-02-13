
import axios from "axios";

async function checkPath(domain: string, id: string) {
    const paths = [`/play/${id}`, `/v/${id}`, `/watch/${id}`];
    for (const path of paths) {
        const url = `${domain}${path}`;
        try {
            console.log(`Checking ${url}...`);
            const res = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://allmovieland.link/',
                },
                validateStatus: () => true
            });
            if (res.status === 200) {
                console.log(`Snippet: ${res.data.substring(0, 500)}`);
                console.log(`Full HTML: ${res.data}`);
            }
        } catch (e: any) {
            console.log(`[ERROR] ${url}: ${e.message}`);
        }
    }
}

async function main() {
    const id = "tt33028778"; // The ID from the logs
    // const id = "tt0137523"; // Fight Club (known older movie)

    console.log("Testing heast404jax.com...");
    await checkPath('https://heast404jax.com', id);

    console.log("\nTesting vekna402las.com (Hardcoded fallback)...");
    await checkPath('https://vekna402las.com', id);

    console.log("\nTesting cloudnestra.com (Blacklisted)...");
    await checkPath('https://cloudnestra.com', id);
}

main();
