
export function getMapplUrl(id: string, type: 'movie' | 'tv' = 'movie', season?: number, episode?: number): string {
    const baseUrl = 'https://mappl.tv';

    // Ensure id is IMDB ID format (tt...)
    if (!id.startsWith('tt')) {
        // This should be handled by the caller using resolveTmdbToImdb
        // but we'll return a placeholder just in case
        return `${baseUrl}/${type === 'movie' ? 'movie' : 'tv'}/${id}`;
    }

    if (type === 'movie') {
        return `${baseUrl}/movie/${id}`;
    } else {
        let url = `${baseUrl}/tv/${id}`;
        if (season && episode) {
            url += `?s=${season}&e=${episode}`;
        }
        return url;
    }
}
