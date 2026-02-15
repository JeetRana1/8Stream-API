import http from "node:http";
import https from "node:https";
import { SocksProxyAgent } from 'socks-proxy-agent';

export const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

// Persistent agents for connection pooling
export const keepAliveHttpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 150,
    scheduling: 'lifo'
});

export const keepAliveHttpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 150,
    scheduling: 'lifo'
});

// Shared Host Cache for Tor preference
export const hostNeedsTor = new Map<string, { timestamp: number }>();
export const HOST_BLOCK_TTL = 30 * 60 * 1000; // 30 minutes

export function shouldPreferTor(url: string): boolean {
    const lower = url.toLowerCase();
    return (
        lower.includes("heast404jax.com") ||
        lower.includes("i-arch-") ||
        lower.includes("/stream2/") ||
        lower.includes("i-cdn-") ||
        lower.includes("lizer123.site") ||
        lower.includes("vekna402las.com")
    );
}
