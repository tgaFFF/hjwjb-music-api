(function() {
    if (window.BlobManager) return;
    
    window.BlobManager = {
        urls: new Map(),
        maxUrls: 50,
        cleanupThreshold: 10,

        create(blob, key) {
            const url = URL.createObjectURL(blob);
            const mapKey = key != null ? key : url;

            // Avoid leaking old object URLs when reusing the same key.
            if (this.urls.has(mapKey)) {
                try {
                    const prev = this.urls.get(mapKey);
                    if (prev && prev.url) URL.revokeObjectURL(prev.url);
                } catch (e) {
                    // ignore
                }
            }

            const info = { url, key: mapKey, createdAt: Date.now() };
            this.urls.set(mapKey, info);
            
            if (this.urls.size > this.maxUrls) {
                this.cleanupOldest(this.cleanupThreshold);
            }
            
            return url;
        },

        revoke(keyOrUrl) {
            if (this.urls.has(keyOrUrl)) {
                const info = this.urls.get(keyOrUrl);
                URL.revokeObjectURL(info.url);
                this.urls.delete(keyOrUrl);
                return;
            }
            this.revokeUrl(keyOrUrl);
        },

        revokeUrl(url) {
            this.urls.forEach((info, key) => {
                if (info.url === url) {
                    URL.revokeObjectURL(url);
                    this.urls.delete(key);
                }
            });
        },

        cleanupByKey(key) {
            this.revoke(key);
        },

        cleanupByPattern(pattern) {
            const keysToDelete = [];
            this.urls.forEach((info, key) => {
                if (pattern.test(key)) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(key => this.revoke(key));
        },

        cleanupOldest(count) {
            const sorted = Array.from(this.urls.entries())
                .sort((a, b) => a[1].createdAt - b[1].createdAt)
                .slice(0, count);
            sorted.forEach(([key, info]) => {
                URL.revokeObjectURL(info.url);
                this.urls.delete(key);
            });
        },

        cleanupExpired(maxAge = 3600000) {
            const now = Date.now();
            const keysToDelete = [];
            this.urls.forEach((info, key) => {
                if (now - info.createdAt > maxAge) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(key => this.revoke(key));
        },

        cleanupAll() {
            this.urls.forEach((info) => {
                URL.revokeObjectURL(info.url);
            });
            this.urls.clear();
        },

        getStats() {
            const oldest = Array.from(this.urls.values())
                .sort((a, b) => a.createdAt - b.createdAt)[0];
            return {
                count: this.urls.size,
                oldest: oldest ? {
                    key: oldest.key,
                    age: Date.now() - oldest.createdAt
                } : null
            };
        },

        has(key) {
            return this.urls.has(key);
        },

        get(key) {
            const info = this.urls.get(key);
            return info ? info.url : null;
        }
    };

    window.addEventListener('beforeunload', () => window.BlobManager.cleanupAll());
    window.addEventListener('pagehide', () => window.BlobManager.cleanupAll());
})();
