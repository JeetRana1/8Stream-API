# 🔍 Quick Debugging Reference

## Common Issues & Solutions

### Issue: Black screen in player

**Symptoms**:
- Player loads but shows black screen
- Console shows: `Fetching MediaInfo for tt...` but nothing else

**Possible Causes**:
1. ✅ **FIXED**: API returned blacklisted domain → Now skipped automatically
2. ✅ **FIXED**: API returned inconsistent structure → Now always consistent
3. ⚠️ **Check**: Frontend not handling response correctly → See fix below

**Frontend Fix**:
```javascript
// Make sure you're checking the response properly
fetch('/api/mediainfo?id=tt123&type=movie')
  .then(r => r.json())
  .then(data => {
    console.log('MediaInfo response:', data);
    
    // Check structure
    if (!data || typeof data.success === 'undefined') {
      console.error('Invalid response structure:', data);
      return;
    }
    
    // Handle based on success
    if (data.success) {
      loadStreams(data);
    } else {
      showError(data.message || 'No streams available');
    }
  });
```

---

### Issue: "Cannot read properties of undefined (reading 'results')"

**Cause**: Frontend trying to access `data.results` which doesn't exist

**Fix**: Update frontend to use correct structure:
```javascript
// ❌ Wrong
const results = data.results; // undefined!

// ✅ Correct
const playlist = data.data?.playlist || [];
const extraSources = data.extraSources || [];
```

---

### Issue: Some movies work, others don't

**This is EXPECTED behavior**. Not all content is available on all sources.

**What happens**:
1. API tries primary source (8Stream)
2. If that fails, tries 5 alternative scrapers
3. If ALL fail, returns `success: false`

**Check logs**:
```
✅ Working content:
Response data (enhanced): { success: true, primarySuccess: true, extraSourcesCount: 3 }

⚠️ Partial (alternatives only):
Response data (enhanced): { success: true, primarySuccess: false, extraSourcesCount: 2 }

❌ Not available:
Response data (enhanced): { success: false, primarySuccess: false, extraSourcesCount: 0 }
```

---

### Issue: Blacklisted domain errors

**Symptoms**:
```
[scrapeVidsrc] Base domain https://cloudnestra.com/... is blacklisted. Skipping https://vidsrc.net
```

**Status**: ✅ This is NORMAL and EXPECTED

**Why**: These domains are blocked by ad blockers. The API automatically skips them and tries other sources.

**Action**: None needed. This is working as intended.

---

### Issue: 404 errors from heast404jax.com

**Symptoms**:
```
[getInfo] Tor failed with status 404
[getInfo] Direct failed with status 404
```

**Status**: ⚠️ Primary source doesn't have this content

**Why**: The primary source (8Stream/AllMovieLand) doesn't have every movie/show

**Action**: None needed if alternatives are working. Check if `extraSourcesCount > 0`

---

## API Response Structure Reference

### Success Response (with primary source):
```json
{
  "success": true,
  "data": {
    "playlist": [
      {
        "file": "https://...",
        "title": "1080p"
      }
    ],
    "key": "csrf-token"
  },
  "extraSources": [
    {
      "id": "vixsrc",
      "source": "vixsrc.to",
      "success": true,
      "streamUrl": "https://...",
      "isEmbed": true
    }
  ],
  "source": "8stream"
}
```

### Success Response (alternatives only):
```json
{
  "success": true,
  "data": {
    "playlist": [],
    "key": ""
  },
  "message": "Using alternative sources",
  "extraSources": [
    {
      "id": "vixsrc",
      "source": "vixsrc.to",
      "success": true,
      "streamUrl": "https://...",
      "isEmbed": true
    }
  ],
  "source": "8stream"
}
```

### Failure Response:
```json
{
  "success": false,
  "data": {
    "playlist": [],
    "key": ""
  },
  "message": "No streams available",
  "extraSources": [],
  "source": "8stream"
}
```

---

## Testing Commands

### Test API locally:
```bash
# Start server
npm start

# In another terminal, test response structure
node test_response_structure.js

# Or test specific ID
curl "http://localhost:3000/api/mediainfo?id=tt0137523&type=movie"
```

### Check if server is running:
```bash
curl http://localhost:3000/health
# or
curl http://localhost:3000/api/mediainfo?id=tt0137523&type=movie
```

---

## Frontend Checklist

When integrating, make sure your frontend:

- [ ] Checks `data.success` before accessing other fields
- [ ] Handles both `data.data.playlist` (primary) and `data.extraSources` (alternatives)
- [ ] Shows user-friendly error when `success: false`
- [ ] Doesn't crash on undefined/null values
- [ ] Logs the full response for debugging: `console.log('MediaInfo:', data)`

---

## Log Patterns to Watch

### ✅ Good (everything working):
```
[mediaInfo] Returning cached result for ID: tt0137523
Response data (enhanced): { success: true, primarySuccess: true, extraSourcesCount: 3 }
```

### ⚠️ Warning (expected, not an error):
```
[scrapeVidsrc] Base domain https://cloudnestra.com/... is blacklisted. Skipping
[getInfo] Tor failed with status 404
```

### ❌ Error (needs investigation):
```
Error in getInfo: timeout of 10000ms exceeded
[mediaInfo] New scrapers failed: <unexpected error>
error in mediaInfo: <unexpected error>
```

---

## Quick Fixes

### Frontend shows "undefined" or crashes:
→ Update to use `data.data.playlist` and `data.extraSources`

### All content shows "No streams available":
→ Check if API server is running
→ Check network tab for API response
→ Check API logs for errors

### Some content works, some doesn't:
→ This is normal! Not all content is available
→ Check logs to see which sources were tried

### Build fails on Windows:
→ ✅ Fixed! Use `npm run build` (now uses semicolons)

---

## Need More Help?

1. Check **STREAMING_FIXES.md** for detailed frontend integration
2. Check **FIX_SUMMARY.md** for overview of changes
3. Check API logs for specific error messages
4. Test with `test_response_structure.ts` to verify API structure
