(function () {
    if (window.StorageManager && typeof window.StorageManager.getItem === 'function') {
        return;
    }

    function notifyWrite(key, value) {
        try {
            window.dispatchEvent(new CustomEvent('hjwjb-storage-write', { detail: { key, value } }));
        } catch (e) {
            // ignore
        }
    }

    window.StorageManager = {
        pendingWrites: new Map(),
        writeTimeout: null,
        DEBOUNCE_DELAY: 100, // ms

        setItem(key, value) {
            this.pendingWrites.set(key, typeof value === 'string' ? value : JSON.stringify(value));
            if (this.writeTimeout) clearTimeout(this.writeTimeout);
            this.writeTimeout = setTimeout(() => this.flush(), this.DEBOUNCE_DELAY);
        },

        flush() {
            if (this.writeTimeout) {
                clearTimeout(this.writeTimeout);
                this.writeTimeout = null;
            }
            this.pendingWrites.forEach((value, key) => {
                try {
                    localStorage.setItem(key, value);
                    notifyWrite(key, value);
                } catch (e) {
                    if (typeof console !== 'undefined' && console.error) {
                        console.error(`保存 ${key} 失败:`, e);
                    }
                }
            });
            this.pendingWrites.clear();
        },

        getItem(key, defaultValue = null) {
            try {
                const value = localStorage.getItem(key);
                if (value === null) return defaultValue;

                // Compatibility: some settings are stored as raw strings (e.g. "api9") and are not valid JSON.
                try {
                    return JSON.parse(value);
                } catch (e) {
                    // If the caller provided an object/array default, a parse failure likely means corrupted JSON.
                    // For primitive defaults (string/number/bool), prefer returning the raw string.
                    const hasDefault = arguments.length >= 2;
                    const defaultIsObject = hasDefault && defaultValue != null && typeof defaultValue === 'object';
                    return defaultIsObject ? defaultValue : value;
                }
            } catch (e) {
                return defaultValue;
            }
        },

        removeItem(key) {
            this.pendingWrites.delete(key);
            try {
                localStorage.removeItem(key);
            } finally {
                notifyWrite(key, null);
            }
        },

        clear() {
            this.pendingWrites.clear();
            try {
                localStorage.clear();
            } finally {
                notifyWrite('*', null);
            }
        }
    };

    // Best-effort: flush debounced writes when the page is being hidden/unloaded.
    try {
        const flushSoon = () => {
            try {
                if (window.StorageManager && typeof window.StorageManager.flush === 'function') {
                    window.StorageManager.flush();
                }
            } catch (e) {
                // ignore
            }
        };

        window.addEventListener('pagehide', flushSoon);
        window.addEventListener('beforeunload', flushSoon);
        if (document && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                try {
                    if (document.visibilityState === 'hidden') flushSoon();
                } catch (e) {
                    // ignore
                }
            });
        }
    } catch (e) {
        // ignore
    }
})();
