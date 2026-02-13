
import axios from "axios";

async function checkDomain(domain: string) {
    const url = `${domain}/player.js`;
    try {
        console.log(`Checking availability of ${domain}...`);
        const res = await axios.head(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            validateStatus: () => true // Accept all status codes to see what we get
        });
        console.log(`[${res.status}] ${domain} is reachable.`);
    } catch (e: any) {
        console.log(`[ERROR] ${domain} failed: ${e.message}`);
    }
}

async function main() {
    await checkDomain('https://heast404jax.com');
    await checkDomain('https://cloudnestra.com');
    await checkDomain('https://vekna402las.com');
    await checkDomain('https://allmovieland.io');
}

main();
