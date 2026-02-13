import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import router from "./routes/route";
import rateLimit from "express-rate-limit";
import cache from "./lib/cache";
import { scrapeAll } from "./lib/scrapers";
import axios from "axios";

const app = express();

app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);
dotenv.config();
app.use(express.json());

// Temporarily disabling rate limiter to avoid proxy issues on Vercel
// const limiter = rateLimit({
//   windowMs: 5 * 60 * 1000, // 5 minutes
//   max: 1000, // Increased limit for streaming usage
//   message: "Too many requests, please try again later.",
// });
// if (process.env.RATE_LIMIT === "true") {
//   app.use(limiter);
// }
app.get("/", (req, res) => {
  res.send("its ok");
});

// Endpoint to clear cache (for debugging purposes)
app.get("/admin/clear-cache", (req, res) => {
  const adminKey = process.env.ADMIN_KEY || "admin123"; // Default key for development
  const providedKey = req.query.key as string;

  if (providedKey === adminKey) {
    cache.clear();
    res.json({ success: true, message: "Cache cleared successfully" });
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
});

// Alias for relative path streaming (catches /stream/ requests from root)
import proxy from "./controllers/proxy";
app.all("/stream/*", proxy);

// Extract endpoint (inspired by vidsrc-scraper)
app.get("/api/v1/extract", async (req, res) => {
  const { id, type, s, e } = req.query;
  if (!id) return res.status(400).json({ success: false, message: "ID is required" });

  try {
    const results = await scrapeAll(
      id as string,
      (type as any) || "movie",
      s ? parseInt(s as string) : undefined,
      e ? parseInt(e as string) : undefined
    );
    res.json({ success: results.length > 0, results });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Subtitle Proxy (SRT to VTT conversion)
app.get("/api/v1/subtitle-proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Subtitle URL is required");

  try {
    const response = await axios.get(url as string, { responseType: 'text' });
    const srt = response.data;

    // Manual SRT to VTT conversion (regex-based)
    const vtt = "WEBVTT\n\n" + srt
      .replace(/\r+/g, "")
      .trim()
      .split("\n")
      .map((line: string) => line.replace(/(\d{2}):(\d{2}):(\d{2})[,](\d{3})/g, "$1:$2:$3.$4"))
      .join("\n");

    res.setHeader("Content-Type", "text/vtt");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(vtt);
  } catch (err: any) {
    res.status(500).send("Failed to proxy subtitle: " + err.message);
  }
});

app.use("/api/v1", router);

const Port = process.env.PORT || 7860;

app.listen(Port, () => {
  console.log(`Server running on port ${Port} (v3 - Direct Fallback enabled)`);
});

// Global Error Handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...', err);
  // Ideally, restart service or log to external service
  // For now, keep running but log to console
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...', err);
  // Ideally, restart service or log to external service
});

export default app;