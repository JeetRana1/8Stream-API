# Streaming Fixes - Black Screen & Error Handling

## Issues Fixed

### 1. **Blacklisted Domains**
**Problem**: Some scrapers (VidSrc, VidSrcMe) were returning URLs from blacklisted domains like:
- `cloudnestra.com`
- `protection-episode-i-222.site`
- `malocacomals.com`

These domains are blocked by ad blockers and security extensions, causing streams to fail.

**Solution**: 
- Added early detection of blacklisted domains in `lib/scrapers/vidsrc.ts`
- Scrapers now skip and return failure immediately when encountering these domains
- Removed fallback logic that would return blacklisted iframe sources

### 2. **404 Errors from Primary Source**
**Problem**: The primary source (`heast404jax.com`) was returning 404 for many titles.

**Solution**:
- Enhanced `controllers/mediaInfo.ts` to handle primary source failures gracefully
- API now marks request as successful if ANY source (primary or alternative) returns streams
- Consistent data structure is always returned, even when all sources fail

### 3. **Frontend Crashes**
**Problem**: Frontend was crashing with `Cannot read properties of undefined (reading 'results')` when no streams were available.

**Solution**:
- API now ALWAYS returns a consistent structure:
```json
{
  "success": true/false,
  "data": {
    "playlist": [],
    "key": ""
  },
  "message": "Optional error/info message",
  "extraSources": [],
  "source": "8stream"
}
```

## Frontend Integration Guide

### Expected API Response Structure

```typescript
interface MediaInfoResponse {
  success: boolean;
  data: {
    playlist: Array<{
      file?: string;
      folder?: Array<any>;
      title?: string;
    }>;
    key: string;
  };
  message?: string;
  extraSources: Array<{
    id: string;
    source: string;
    success: boolean;
    streamUrl?: string;
    isEmbed?: boolean;
    name?: string;
  }>;
  source: string;
}
```

### Frontend Error Handling Example

```javascript
async function fetchMediaInfo(id, type, season, episode) {
  try {
    const params = new URLSearchParams({
      id: id,
      type: type || 'movie'
    });
    
    if (type === 'tv') {
      params.append('s', season || '1');
      params.append('e', episode || '1');
    }
    
    const response = await fetch(`/api/mediainfo?${params}`);
    const data = await response.json();
    
    console.log('Fetching MediaInfo for', id);
    
    // Check if we have any streams
    if (!data.success) {
      console.error('No streams available:', data.message);
      showError('No streams available for this content');
      return null;
    }
    
    // Check primary source
    if (data.data && data.data.playlist && data.data.playlist.length > 0) {
      console.log('Using primary source (8Stream)');
      return {
        type: 'primary',
        playlist: data.data.playlist,
        key: data.data.key
      };
    }
    
    // Check alternative sources
    if (data.extraSources && data.extraSources.length > 0) {
      console.log('Using alternative sources:', data.extraSources.length);
      return {
        type: 'alternative',
        sources: data.extraSources
      };
    }
    
    // No streams found
    console.error('No streams in response');
    showError('No playable streams found');
    return null;
    
  } catch (error) {
    console.error('Error fetching media info:', error);
    showError('Failed to load stream information');
    return null;
  }
}

function showError(message) {
  // Display error to user
  const playerContainer = document.getElementById('player-container');
  if (playerContainer) {
    playerContainer.innerHTML = `
      <div class="error-message">
        <h3>⚠️ Playback Error</h3>
        <p>${message}</p>
        <p>Please try:</p>
        <ul>
          <li>Selecting a different quality or server</li>
          <li>Refreshing the page</li>
          <li>Trying again later</li>
        </ul>
      </div>
    `;
  }
}
```

### Player Integration Example

```javascript
function loadPlayer(mediaInfo) {
  if (!mediaInfo) {
    showError('No media information available');
    return;
  }
  
  if (mediaInfo.type === 'primary') {
    // Load 8Stream playlist
    loadPrimaryPlayer(mediaInfo.playlist, mediaInfo.key);
  } else if (mediaInfo.type === 'alternative') {
    // Load alternative sources
    loadAlternativePlayer(mediaInfo.sources);
  }
}

function loadPrimaryPlayer(playlist, key) {
  // Your existing 8Stream player logic
  console.log('Loading primary player with', playlist.length, 'items');
  // ... player initialization
}

function loadAlternativePlayer(sources) {
  // Create source selector UI
  const sourceSelector = document.createElement('div');
  sourceSelector.className = 'source-selector';
  
  sources.forEach((source, index) => {
    const button = document.createElement('button');
    button.textContent = `${source.source} - ${source.name || 'Server ' + (index + 1)}`;
    button.onclick = () => loadSource(source);
    sourceSelector.appendChild(button);
  });
  
  document.getElementById('player-container').prepend(sourceSelector);
  
  // Auto-load first source
  if (sources.length > 0) {
    loadSource(sources[0]);
  }
}

function loadSource(source) {
  if (source.isEmbed && source.streamUrl) {
    // Load as iframe
    const iframe = document.createElement('iframe');
    iframe.src = source.streamUrl;
    iframe.allowFullscreen = true;
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.style.width = '100%';
    iframe.style.height = '500px';
    iframe.style.border = 'none';
    
    const container = document.getElementById('player-container');
    container.innerHTML = '';
    container.appendChild(iframe);
  }
}
```

## Testing

After deploying these changes, test with:

1. **Working content**: Should load normally from primary or alternative sources
2. **Unavailable content**: Should show proper error message instead of crashing
3. **Blacklisted sources**: Should skip automatically and try next source

## Cache Behavior

- **Successful responses**: Cached for 30 minutes
- **Failed responses**: Cached for 5 minutes (allows retries sooner)
- **Error responses**: Cached for 2 minutes

## Monitoring

Check your logs for these patterns:

```
✅ Good:
[mediaInfo] Returning cached result for ID: tt1234567
Response data (enhanced): { success: true, primarySuccess: true, extraSourcesCount: 3 }

⚠️ Primary failed, alternatives work:
Response data (enhanced): { success: true, primarySuccess: false, extraSourcesCount: 2, message: 'Using alternative sources' }

❌ All failed:
Response data (enhanced): { success: false, primarySuccess: false, extraSourcesCount: 0, message: 'No streams available' }
[scrapeVidsrc] Base domain https://cloudnestra.com/... is blacklisted. Skipping https://vidsrc.net
```

## Next Steps

1. **Deploy the updated API**
2. **Update your frontend** to handle the new response structure
3. **Add user-friendly error messages** for when streams aren't available
4. **Consider adding a "Report Issue" button** for content that consistently fails
