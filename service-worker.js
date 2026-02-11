
// Service Worker for HJWJB音乐播放器
// 用于实现移动端通知栏的播放控制功能

self.addEventListener('install', (_event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// 处理来自主线程的消息
self.addEventListener('message', (event) => {
    const data = event.data;
    if (data.type === 'UPDATE_MEDIA_SESSION') {
        // 保存当前播放状态
        self.currentSong = data.song;
        self.isPlaying = data.isPlaying;
        self.currentTime = data.currentTime;
        self.duration = data.duration;
    }
});

// 处理推送通知（如果需要）
self.addEventListener('push', (_event) => {
    // 可以在这里处理推送通知
});
