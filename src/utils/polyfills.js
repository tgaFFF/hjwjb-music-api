(function configureLogs() {
    // 默认安静；需要调试时在地址栏加 ?debug=1 或 localStorage.hjwjb_debug="true"
    // search.html 没有单独的 Logger，这里统一做一次控制
    let debugEnabled = false;
    const search = (window.location && window.location.search) || '';
    const enableByQuery = /[?&]debug=1/.test(search);
    const disableByQuery = /[?&]debug=0/.test(search);

    // 让 debug 开关在 index/search 等页面间保持一致：
    // - 访问任意页面带 ?debug=1 会写入 localStorage
    // - 访问任意页面带 ?debug=0 会清除 localStorage
    try {
        if (enableByQuery) localStorage.setItem('hjwjb_debug', 'true');
        if (disableByQuery) localStorage.removeItem('hjwjb_debug');
    } catch (e) {
        // ignore
    }
    try {
        debugEnabled = localStorage.getItem('hjwjb_debug') === 'true';
    } catch (e) {
        debugEnabled = false;
    }
    if (!debugEnabled) {
        debugEnabled = enableByQuery;
    }
    window.__HJWJB_DEBUG__ = debugEnabled;

    if (!debugEnabled && window.console) {
        const noop = function () {};
        console.log = noop;
        console.info = noop;
        console.debug = noop;
    }
})();

(function () {
    // Object.assign (ES2015) polyfill
    if (typeof Object.assign !== 'function') {
        Object.assign = function (target) {
            if (target === null || target === undefined) {
                throw new TypeError('Cannot convert undefined or null to object');
            }
            const to = Object(target);
            for (let i = 1; i < arguments.length; i++) {
                const nextSource = arguments[i];
                if (nextSource === null || nextSource === undefined) continue;
                for (const key in nextSource) {
                    if (Object.prototype.hasOwnProperty.call(nextSource, key)) {
                        to[key] = nextSource[key];
                    }
                }
            }
            return to;
        };
    }

    // Array.prototype.includes (ES2016) polyfill
    if (!Array.prototype.includes) {
        Array.prototype.includes = function (searchElement, fromIndex) {
            if (this === null || this === undefined) {
                throw new TypeError('Array.prototype.includes called on null or undefined');
            }
            const o = Object(this);
            const len = parseInt(o.length, 10) || 0;
            if (len === 0) return false;
            const n = parseInt(fromIndex, 10) || 0;
            let k = n >= 0 ? n : Math.max(len + n, 0);
            while (k < len) {
                const currentElement = o[k];
                if (searchElement === currentElement || (searchElement !== searchElement && currentElement !== currentElement)) {
                    return true;
                }
                k++;
            }
            return false;
        };
    }

    // NodeList.prototype.forEach polyfill
    if (window.NodeList && !NodeList.prototype.forEach) {
        NodeList.prototype.forEach = function (callback, thisArg) {
            if (typeof callback !== 'function') return;
            for (let i = 0; i < this.length; i++) {
                callback.call(thisArg, this[i], i, this);
            }
        };
    }

    // Element.matches / Element.closest polyfill
    if (window.Element && !Element.prototype.matches) {
        Element.prototype.matches =
            Element.prototype.msMatchesSelector ||
            Element.prototype.webkitMatchesSelector ||
            function (selector) {
                const node = this;
                const nodes = (node.document || node.ownerDocument).querySelectorAll(selector);
                let i = 0;
                while (nodes[i] && nodes[i] !== node) i++;
                return !!nodes[i];
            };
    }

    if (window.Element && !Element.prototype.closest) {
        Element.prototype.closest = function (selector) {
            let node = this;
            while (node && node.nodeType === 1) {
                if (node.matches(selector)) return node;
                node = node.parentElement || node.parentNode;
            }
            return null;
        };
    }

    // CustomEvent polyfill (for older WebView)
    try {
        // eslint-disable-next-line no-new
        new window.CustomEvent('hjwjb:test', { detail: {} });
    } catch (e) {
        const CustomEventPoly = function (event, params) {
            params = params || { bubbles: false, cancelable: false, detail: null };
            const evt = document.createEvent('CustomEvent');
            evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
            return evt;
        };
        CustomEventPoly.prototype = window.Event && window.Event.prototype;
        window.CustomEvent = CustomEventPoly;
    }
})();

(function () {
    // 解决移动端 100vh 计算导致的“多出空白/抖动”：
    // 用 --vh 绑定到真实可视高度（尽量用 visualViewport）
    function getViewportHeight() {
        const docEl = document.documentElement;
        const innerHeight = window.innerHeight || 0;
        const clientHeight = docEl && docEl.clientHeight ? docEl.clientHeight : 0;
        let height = innerHeight || clientHeight || 0;

        if (window.visualViewport && typeof window.visualViewport.height === 'number') {
            const vvHeight = window.visualViewport.height;
            if (vvHeight > 0) {
                height = height ? Math.min(height, vvHeight) : vvHeight;
            }
        }

        if (clientHeight > 0) {
            height = height ? Math.min(height, clientHeight) : clientHeight;
        }

        return height;
    }

    function setVhVar() {
        try {
            const vh = getViewportHeight() * 0.01;
            document.documentElement.style.setProperty('--vh', vh + 'px');
        } catch (e) {
            // ignore
        }
    }

    let timer = null;
    function scheduleSetVhVar() {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(function () {
            timer = null;
            setVhVar();
        }, 120);
    }

    setVhVar();
    window.addEventListener('resize', scheduleSetVhVar);
    window.addEventListener('orientationchange', scheduleSetVhVar);
    window.addEventListener('load', scheduleSetVhVar);
    window.addEventListener('pageshow', scheduleSetVhVar);
    window.addEventListener('focus', scheduleSetVhVar);
    document.addEventListener('visibilitychange', scheduleSetVhVar);
    window.addEventListener('scroll', scheduleSetVhVar, { passive: true });

    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
        window.visualViewport.addEventListener('resize', scheduleSetVhVar);
        window.visualViewport.addEventListener('scroll', scheduleSetVhVar);
    }
})();

(function () {
    // 布局自修复：移动端偶发“顶部栏宽度缩窄/右侧空白”
    // search.html 不加载 script.js，因此这里提供一个通用兜底
    let scheduled = false;
    let warned = false;
    let repaintScheduled = false;
    let headerFullWidthApplied = false;
    let overflowWarned = false;
    let overflowDebugged = false;

    function getViewportWidth() {
        const docEl = document.documentElement;
        const cw = docEl && docEl.clientWidth ? docEl.clientWidth : 0;
        return cw || window.innerWidth || 0;
    }

    function nudgeRepaint(el) {
        if (!el || repaintScheduled) return;
        repaintScheduled = true;
        try {
            const prevTransform = el.style.transform;
            const prevWebkitTransform = el.style.webkitTransform;
            const prevWillChange = el.style.willChange;

            el.style.willChange = 'transform';
            el.style.webkitTransform = 'translateZ(0)';
            el.style.transform = 'translateZ(0)';

            const restore = function () {
                try {
                    el.style.webkitTransform = prevWebkitTransform;
                    el.style.transform = prevTransform;
                    el.style.willChange = prevWillChange;
                } catch (e) {
                    // ignore
                }
                repaintScheduled = false;
            };

            if (typeof window.requestAnimationFrame === 'function') {
                // 用两帧保证样式生效，但不做同步强制回流（避免 [Violation] Forced reflow）
                window.requestAnimationFrame(function () {
                    window.requestAnimationFrame(restore);
                });
            } else {
                window.setTimeout(restore, 32);
            }
        } catch (e) {
            repaintScheduled = false;
        }
    }

    function ensureHeaderFullWidth(header) {
        if (!header || headerFullWidthApplied) return;
        try {
            const viewportWidth = getViewportWidth();
            if (!viewportWidth || viewportWidth > 1100) return;

            let headerWidth = 0;
            try {
                if (header.getBoundingClientRect) {
                    headerWidth = header.getBoundingClientRect().width;
                } else if (typeof header.offsetWidth === 'number') {
                    headerWidth = header.offsetWidth;
                }
            } catch (e) {
                headerWidth = 0;
            }

            if (headerWidth && headerWidth + 2 >= viewportWidth) {
                return;
            }

            headerFullWidthApplied = true;
            header.style.width = '100vw';
            header.style.minWidth = '100vw';
            header.style.maxWidth = '100vw';
            header.style.marginLeft = 'calc(50% - 50vw)';
            header.style.marginRight = 'calc(50% - 50vw)';
            header.style.boxSizing = 'border-box';
        } catch (e) {
            // ignore
        }
    }

    function debugOverflowElement(viewportWidth) {
        if (!window.__HJWJB_DEBUG__ || overflowDebugged) return;
        overflowDebugged = true;

        window.setTimeout(function () {
            try {
                const vw = viewportWidth || getViewportWidth();
                if (!vw) return;

                let worstEl = null;
                let worstOverflow = 0;
                const nodes = document.querySelectorAll('body *');
                for (let i = 0; i < nodes.length; i++) {
                    const el = nodes[i];
                    if (!el || !el.getBoundingClientRect) continue;
                    const rect = el.getBoundingClientRect();
                    const overflow = Math.max(rect.right - vw, 0, -rect.left);
                    if (overflow > worstOverflow + 0.5) {
                        worstOverflow = overflow;
                        worstEl = el;
                    }
                }

                if (worstEl && worstOverflow > 0.5 && window.console && console.warn) {
                    const id = worstEl.id ? '#' + worstEl.id : '';
                    const cls = worstEl.className ? '.' + String(worstEl.className).trim().replace(/\\s+/g, '.') : '';
                    console.warn('🧱 检测到横向溢出来源(候选):', worstEl.tagName.toLowerCase() + id + cls, {
                        overflow: worstOverflow,
                        rect: worstEl.getBoundingClientRect(),
                        viewportWidth: vw
                    });
                }
            } catch (e) {
                // ignore
            }
        }, 0);
    }

    function fixRootOverflowXIfNeeded(reason, viewportWidth) {
        try {
            const docEl = document.documentElement;
            if (!docEl) return;

            const vw = viewportWidth || getViewportWidth();
            if (!vw) return;

            const sw = docEl.scrollWidth || 0;
            if (!sw || sw <= vw + 1) return;

            // 兜底：部分移动端 WebView 即使写了 CSS overflow-x:hidden 仍可能被“可视溢出”拉宽
            docEl.style.overflowX = 'hidden';
            if (document.body) {
                document.body.style.overflowX = 'hidden';
                document.body.style.touchAction = 'pan-y';
            }

            if (!overflowWarned && window.__HJWJB_DEBUG__ && window.console && console.warn) {
                overflowWarned = true;
                console.warn('🧱 检测到页面横向溢出，已自动兜底隐藏', { reason: reason || '', scrollWidth: sw, viewportWidth: vw });
            }

            debugOverflowElement(vw);
        } catch (e) {
            // ignore
        }
    }

    function fixHeaderFullWidthIfNeeded(reason) {
        try {
            const header = document.querySelector('.header');
            if (!header) return;

            const viewportWidth = getViewportWidth();
            if (!viewportWidth) return;

            // 统一让 header 铺满视口（包含滚动条区域），避免“导入后右侧空白”
            ensureHeaderFullWidth(header);

            // 无论是否命中“宽度变窄”，都做一次轻量强制重绘：
            // 解决部分内核在大量 DOM 更新后出现的“只渲染左半边/右侧空白”合成层问题
            if (viewportWidth <= 1100) {
                nudgeRepaint(header);
            }

            fixRootOverflowXIfNeeded(reason, viewportWidth);

            if (!warned && window.__HJWJB_DEBUG__ && window.console && console.warn) {
                warned = true;
                console.warn('🔧 header 布局兜底已启用', { reason: reason || '', viewportWidth });
            }
        } catch (e) {
            // ignore
        }
    }

    function scheduleFix(reason) {
        if (scheduled) return;
        scheduled = true;
        window.setTimeout(function () {
            scheduled = false;
            fixHeaderFullWidthIfNeeded(reason);
        }, 60);
    }

    // 暴露给页面脚本：当发生大规模 DOM 更新时可手动触发一次兜底（例如更新播放列表）
    window.__HJWJB_SCHEDULE_HEADER_FIX__ = scheduleFix;

    function setupMutationObservers() {
        if (typeof window.MutationObserver !== 'function') return;
        const targets = [];
        const playlist = document.getElementById('playlist-container');
        if (playlist) targets.push(playlist);
        const results = document.getElementById('search-results');
        if (results) targets.push(results);
        if (!targets.length) return;

        try {
            const observer = new MutationObserver(function () {
                scheduleFix('mutation');
            });
            for (let i = 0; i < targets.length; i++) {
                observer.observe(targets[i], { childList: true, subtree: true });
            }
        } catch (e) {
            // ignore
        }
    }

    function onReady() {
        // 避开首屏入场动画阶段
        window.setTimeout(function () {
            scheduleFix('DOMContentLoaded');
        }, 1300);

        window.addEventListener('resize', function () {
            scheduleFix('resize');
        });
        window.addEventListener('orientationchange', function () {
            scheduleFix('orientationchange');
        });

        setupMutationObservers();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }
})();
