import express from "express";
import mediaInfo from "../controllers/mediaInfo";
import getStream from "../controllers/getStream";
import getSeasonList from "../controllers/getSeasonList";
import proxy from "../controllers/proxy";
import vidsrc from "../controllers/vidsrc";

const router = express.Router();

router.get("/mediaInfo", mediaInfo);
router.post("/getStream", getStream);
router.get("/vidsrc", vidsrc);
router.get("/getSeasonList", getSeasonList);
router.get("/proxy", proxy); // New CORS Proxy route
router.all("/stream/*", proxy); // Handle encoded streaming paths

export default router;
