
import axios from "axios";

async function tryFetch(url: string) {
    try {
        console.log(`Checking ${url}...`);
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://google.com',
            },
            timeout: 5000
        });

        const resText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const patterns = [
            /const\s+AwsIndStreamDomain\s*=\s*'([^']+)'/,
            /var\s+AwsIndStreamDomain\s*=\s*'([^']+)'/,
            /['"]?AwsIndStreamDomain['"]?\s*[:=]\s*['"]([^'"]+)['"]/,
        ];

        let found = false;
        for (const pattern of patterns) {
            const match = resText.match(pattern);
            if (match && match[1]) {
                console.log(`[SUCCESS] Found domain: ${match[1]} from ${url}`);
                found = true;
                break;
            }
        }
        if (!found) {
            console.log(`[FAILURE] No domain pattern found in ${url}`);
        }

    } catch (e: any) {
        console.log(`[ERROR] Failed to fetch from ${url}: ${e.message}`);
    }
}

async function main() {
    // await tryFetch('https://allmovieland.link/player.js');
    await tryFetch('https://allmovieland.io/player.js');
    // await tryFetch('https://allmovieland.net/player.js');
}

main();
