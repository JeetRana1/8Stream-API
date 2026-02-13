import axios from "axios";
import { Request, Response } from "express";
import { getPlayerUrl } from "../lib/getPlayerUrl";
import { SocksProxyAgent } from 'socks-proxy-agent';

const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

export default async function getStream(req: Request, res: Response) {
  const { file, key } = req.body;

  if (!file || !key) {
    return res.status(400).json({ success: false, message: "Missing file or key" });
  }

  try {
    let finalStreamUrl = "";
    let token = decodeURIComponent(file);
    let proxyRef = "";

    // Support for proxy_ref hint in token
    if (token.includes('proxy_ref=')) {
      const parts = token.split('?');
      token = parts[0];
      const searchParams = new URLSearchParams(parts[1]);
      proxyRef = decodeURIComponent(searchParams.get('proxy_ref') || "");

      // Blacklist check for proxyRef
      if (proxyRef.includes('cloudnestra.com') || proxyRef.includes('protection-episode-i-222.site')) {
        console.log(`[getStream] Ignoring blacklisted proxyRef: ${proxyRef}`);
        proxyRef = "";
      }
    }

    if (token.startsWith('http')) {
      finalStreamUrl = token;
    } else {
      // New logic: fetch token from mirror
      let baseDomain = (proxyRef && proxyRef !== '' ? proxyRef : await getPlayerUrl()).replace(/\/$/, '');

      // Double check resolved domain
      if (baseDomain.includes('cloudnestra.com')) {
        console.log(`[getStream] Resolved domain is blacklisted (cloudnestra.com). Trying to fetch fresh...`);
        baseDomain = (await getPlayerUrl()).replace(/\/$/, '');
      }

      const path = token.startsWith('~') ? token.slice(1) : token;
      const playlistUrl = `${baseDomain}/playlist/${path}.txt`;

      console.log(`[getStream] Mirroring from: ${baseDomain}`);

      let response;
      let lastError;
      const modes = [
        { name: 'Tor', agent: torAgent },
        { name: 'Direct', agent: undefined }
      ];

      for (const mode of modes) {
        try {
          response = await axios.get(playlistUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Referer": baseDomain + "/",
              "X-Csrf-Token": key
            },
            httpAgent: mode.agent,
            httpsAgent: mode.agent,
            responseType: 'text',
            timeout: 15000,
            validateStatus: (status) => status < 500 // Accept any non-5xx status
          });

          console.log(`[getStream] ${mode.name} response status: ${response.status}, data type: ${typeof response.data}`);

          if (response.status === 200 && response.data && typeof response.data === 'string') {
            console.log(`[getStream] Success via ${mode.name}`);
            break;
          } else {
            console.log(`[getStream] ${mode.name} returned invalid data (status ${response.status})`);
            response = undefined; // Invalidate this response
          }
        } catch (e: any) {
          console.log(`[getStream] Failed via ${mode.name}: ${e.message}`);
          lastError = e;
        }
      }

      if (!response && lastError) throw lastError;
      if (!response) throw new Error("Failed to fetch stream from mirror");

      finalStreamUrl = response.data;
      console.log(`[getStream] Received data type: ${typeof finalStreamUrl}, value: ${JSON.stringify(finalStreamUrl).substring(0, 200)}`);
    }

    if (!finalStreamUrl || typeof finalStreamUrl !== 'string' || !finalStreamUrl.startsWith('http')) {
      console.error(`[getStream] Invalid stream URL. Type: ${typeof finalStreamUrl}, Value: ${JSON.stringify(finalStreamUrl)}`);
      return res.status(500).json({ success: false, message: "Invalid stream URL received from mirror" });
    }

    // Wrap in Proxy
    const host = req.get('host');
    const proxySuffix = proxyRef ? `&proxy_ref=${encodeURIComponent(proxyRef)}` : "";
    const proxiedLink = `https://${host}/api/v1/proxy?url=${encodeURIComponent(finalStreamUrl)}${proxySuffix}`;

    res.json({
      success: true,
      data: {
        link: proxiedLink
      }
    });

  } catch (err: any) {
    console.error(`[getStream] Error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
}
