let CACHE_VERSION = 1;

async function handleFetch(event) {
    let request = event.request;
    let cacheable = request.method == "GET" && request.url.match(/https:\/\/api.github.com\//);
    let cache = null;
    if (cacheable) {
        cache = await caches.open(`github-cache-${CACHE_VERSION}`);
    }
    if (cache !== null) {
        let response = await cache.match(request);
        if (response && response.status === 200) {
            response.headers.append("X-ServiceWorker", "true");
            return response;
        }
    }
    let response = await fetch(request);
    if (cache !== null && response.status === 200) {
        cache.put(request.url, response.clone());
    }
    return response;
}

self.addEventListener('fetch', (event) => event.respondWith(handleFetch(event)));
