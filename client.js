/**
 * Client half of the `dsh-bilibili` bundle.
 *
 * Renders the plugin's floating shell: a card anchored to the bottom-right of
 * the frame through the `shell.overlay` slot, stacked just above the
 * bottom-right button row (see the `.dsh-bilibili-dock` rule) so it never
 * covers the 刷新 button.
 *
 * Two faces, both at the bottom-right:
 *   - collapsed: the round launcher, which shows the signed-in avatar once a
 *     Bilibili account is connected;
 *   - open: the panel. Signed out it offers QR sign-in (or a pasted cookie);
 *     signed in it becomes the recommendation feed with 换一批 / 刷新.
 *
 * The browser never talks to Bilibili: every request goes to this package's
 * Host half, which holds the credential and does the outbound HTTPS.
 */
window.__ModuleLoader__.load({
  id: 'dsh-bilibili',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace for the widget's copy. */
    const NS = 'dsh-bilibili';

    /** Same-origin routes served by this package's Host half. */
    const ROUTE = '/dsh-bilibili/session';
    const LOGIN_QRCODE = '/dsh-bilibili/login/qrcode';
    const LOGIN_POLL = '/dsh-bilibili/login/poll';
    const FEED = '/dsh-bilibili/feed';
    const PLAY = '/dsh-bilibili/play';
    const DASH = '/dsh-bilibili/dash';
    const MEDIA = '/dsh-bilibili/media';
    const LIBRARY = '/dsh-bilibili/library';

    const DICTS = {
      zh: {
        open: '打开 dsh-bilibili',
        close: '关闭 dsh-bilibili',
        account: '帐号',
        loading: '正在读取登录态…',
        hint: '先在浏览器登录 B 站，再把 SESSDATA 复制过来。',
        cookieLabel: 'SESSDATA 或整段 Cookie',
        cookiePlaceholder: 'SESSDATA=xxxx',
        save: '保存登录态',
        saving: '校验中…',
        logout: '退出',
        uid: 'UID',
        level: '等级',
        savedAt: '保存于',
        risk: '非官方接口：B 站可能对该账号限流或风控，建议用小号；凭据以 0600 权限保存在本机。',
        expired: '凭据已失效，请重新导入。',
        failed: '出错了',
        needsRestart: '插件 Host 半侧尚未加载，重启 DSH 后此面板才会生效。',
        qrAlt: 'B 站登录二维码',
        qrLoading: '正在生成二维码…',
        qrWaiting: '请用哔哩哔哩 App 扫码登录',
        qrScanned: '已扫码，请在手机上点确认',
        qrExpired: '二维码已过期',
        qrRefresh: '刷新二维码',
        manualSwitch: '改为手动粘贴 Cookie',
        qrSwitch: '← 改为扫码登录',
        retry: '重试',
        feedForYou: '为你推荐',
        feedGeneral: '推荐',
        feedNext: '换一批',
        feedRefresh: '刷新',
        reloading: '刷新中…',
        feedLoading: '正在加载推荐…',
        feedEmpty: '暂无推荐',
        feedFailed: '推荐加载失败',
        feedOpen: '在 B 站打开',
        playLoading: '正在加载视频…',
        playFailed: '视频加载失败',
        back: '返回',
        loadingNext: '加载中…',
        quality: '清晰度',
        qualityFellBack: '高清流不可用，已回退到 720P',
        searchPlaceholder: '搜索 B 站视频…',
        searchAction: '搜索',
        searchTitle: '搜索：',
        historyBtn: '历史',
        favBtn: '收藏',
        nextPage: '下一页',
      },
      en: {
        open: 'Open dsh-bilibili',
        close: 'Close dsh-bilibili',
        account: 'Account',
        loading: 'Reading sign-in state…',
        hint: 'Sign in to Bilibili in your browser first, then copy SESSDATA here.',
        cookieLabel: 'SESSDATA or the whole Cookie header',
        cookiePlaceholder: 'SESSDATA=xxxx',
        save: 'Save credential',
        saving: 'Checking…',
        logout: 'Sign out',
        uid: 'UID',
        level: 'Level',
        savedAt: 'Saved',
        risk: 'Unofficial API: Bilibili may rate-limit or risk-control this account, so a throwaway account is advisable. The credential is stored locally with mode 0600.',
        expired: 'The stored credential is no longer valid. Import a new one.',
        failed: 'Something went wrong',
        needsRestart: 'The plugin Host half is not loaded yet. Restart DSH to activate this panel.',
        qrAlt: 'Bilibili sign-in QR code',
        qrLoading: 'Generating QR code…',
        qrWaiting: 'Scan with the Bilibili app to sign in',
        qrScanned: 'Scanned — confirm on your phone',
        qrExpired: 'This QR code expired',
        qrRefresh: 'Refresh QR code',
        manualSwitch: 'Paste a cookie instead',
        qrSwitch: '← Scan a QR code instead',
        retry: 'Retry',
        feedForYou: 'For you',
        feedGeneral: 'Recommended',
        feedNext: 'Next batch',
        feedRefresh: 'Refresh',
        reloading: 'Refreshing…',
        feedLoading: 'Loading recommendations…',
        feedEmpty: 'Nothing to recommend',
        feedFailed: 'Could not load recommendations',
        feedOpen: 'Open on Bilibili',
        playLoading: 'Loading video…',
        playFailed: 'Could not load the video',
        back: 'Back',
        loadingNext: 'Loading…',
        quality: 'Quality',
        qualityFellBack: 'High-quality stream unavailable; using 720P',
        searchPlaceholder: 'Search Bilibili videos…',
        searchAction: 'Search',
        searchTitle: 'Search: ',
        historyBtn: 'History',
        favBtn: 'Favorites',
        nextPage: 'Next page',
      },
    };

    const CSS = `
.dsh-bilibili-dock {
  position: fixed;
  right: 16px;
  /* Bottom clearance, not the corner itself: the frame's bottom-right button
     row is already owned by dsh-desktop-shortcut (the 刷新 pill at
     right:16/bottom:16, ~30px tall) and dsh-client-deep-sneak (a pill at
     right:18/bottom:18, ~40px tall). Sitting on top of them would cover the
     refresh button, so the dock starts above that ~58px band and opens
     upward. */
  bottom: 72px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: auto;
}
.dsh-bilibili-panel {
  width: 380px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  animation: dsh-bilibili-in 0.16s ease-out;
}
.dsh-bilibili-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-bilibili-brand {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-bilibili-icon {
  display: flex;
  color: var(--dsw-alias-brand-primary);
}
.dsh-bilibili-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-bilibili-btn {
  appearance: none;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.dsh-bilibili-btn:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-bilibili-btn:focus-visible,
.dsh-bilibili-launcher:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-bilibili-textbtn {
  width: auto;
  padding: 0 7px;
  font-family: inherit;
  font-size: 11px;
  line-height: 24px;
}
.dsh-bilibili-body {
  padding: 12px;
}
.dsh-bilibili-note {
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.dsh-bilibili-field {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  margin: 10px 0 4px;
}
.dsh-bilibili-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  min-height: 54px;
}
.dsh-bilibili-input:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-bilibili-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.dsh-bilibili-primary,
.dsh-bilibili-ghost {
  appearance: none;
  border-radius: 8px;
  padding: 6px 12px;
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dsh-bilibili-primary {
  border: 1px solid var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: #ffffff;
  flex: 1;
}
.dsh-bilibili-primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.dsh-bilibili-ghost {
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
.dsh-bilibili-ghost:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-bilibili-ghost:disabled {
  opacity: 0.55;
  cursor: default;
}
.dsh-bilibili-primary:focus-visible,
.dsh-bilibili-ghost:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-bilibili-tiny {
  padding: 4px 10px;
  font-size: 11px;
  line-height: 16px;
}
.dsh-bilibili-link {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-brand-primary);
  cursor: pointer;
  text-align: left;
}
.dsh-bilibili-link:hover {
  text-decoration: underline;
}
.dsh-bilibili-link:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
/* Force black-on-white in both themes: scanners reject inverted QR codes.
   The white padding supplies the quiet zone the spec requires. */
.dsh-bilibili-qrbox {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  margin: 2px 0 8px;
  background: #ffffff;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
}
.dsh-bilibili-qr {
  display: block;
  width: 170px;
  height: 170px;
}
.dsh-bilibili-avatar {
  flex: none;
  border-radius: 50%;
  object-fit: cover;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  box-sizing: border-box;
}
.dsh-bilibili-whose {
  flex: 1;
  min-width: 0;
}
.dsh-bilibili-uname {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-bilibili-meta {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-bilibili-error {
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
  margin-top: 8px;
}
.dsh-bilibili-risk {
  font-size: 10px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-bilibili-feedbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.dsh-bilibili-feedtitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-bilibili-spacer {
  flex: 1;
}
.dsh-bilibili-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-height: 46vh;
  overflow-y: auto;
  padding-right: 2px;
}
.dsh-bilibili-card {
  display: block;
  min-width: 0;
  text-decoration: none;
  color: inherit;
  border-radius: 10px;
  outline-offset: 2px;
}
.dsh-bilibili-card:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
}
.dsh-bilibili-coverwrap {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  aspect-ratio: 16 / 9;
}
.dsh-bilibili-cover {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: 0;
}
.dsh-bilibili-duration {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.72);
  color: #ffffff;
  font-size: 10px;
  line-height: 14px;
  letter-spacing: 0.2px;
}
.dsh-bilibili-cardtitle {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.35;
  color: var(--dsw-alias-label-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dsh-bilibili-card:hover .dsh-bilibili-cardtitle {
  color: var(--dsw-alias-brand-primary);
}
.dsh-bilibili-cardmeta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-bilibili-cardauthor {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-bilibili-cardviews {
  flex: none;
}
.dsh-bilibili-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.dsh-bilibili-searchinput {
  flex: 1;
  min-width: 0;
  height: 30px;
  min-height: 0;
  padding: 4px 10px;
  resize: none;
}
.dsh-bilibili-on {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-bilibili-quality {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 11px;
  line-height: 16px;
  padding: 3px 6px;
  cursor: pointer;
}
.dsh-bilibili-quality:disabled {
  opacity: 0.55;
  cursor: default;
}
.dsh-bilibili-quality:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-bilibili-videowrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  background: #000000;
}
.dsh-bilibili-video {
  display: block;
  width: 100%;
  height: 100%;
  background: #000000;
}
.dsh-bilibili-videofallback {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 12px;
  text-align: center;
}
.dsh-bilibili-videotitle {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--dsw-alias-label-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dsh-bilibili-launcher {
  appearance: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 50%;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-brand-primary);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.16);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  animation: dsh-bilibili-in 0.16s ease-out;
}
.dsh-bilibili-launcher:hover {
  background: var(--dsw-alias-bg-layer-2);
}
@keyframes dsh-bilibili-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-bilibili-panel,
  .dsh-bilibili-launcher { animation: none; }
}
`;

    /**
     * Same-origin JSON call to this package's Host half. The browser must never
     * talk to Bilibili directly (no CORS headers), so these routes are the only
     * door.
     * @param method - HTTP verb.
     * @param body - optional JSON payload.
     * @param target - route to call; defaults to the session route.
     * @returns the parsed response body.
     */
    async function callHost(method, body, target = ROUTE) {
      const init = { method, headers: { accept: 'application/json' } };
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(target, init);
      const payload = await response.json().catch(() => null);
      if (payload === null) {
        const failure = new Error('HTTP ' + response.status);
        failure.status = response.status;
        throw failure;
      }
      return payload;
    }

    /** The Bilibili-style mark, drawn at the requested size in `currentColor`. */
    function BrandMark(size) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M7.4 1.6 12 5.9l4.6-4.3',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('rect', { x: 2, y: 5.2, width: 20, height: 15.3, rx: 4.2, fill: 'currentColor' }),
        h('circle', { cx: 9.1, cy: 12.4, r: 1.9, fill: '#ffffff' }),
        h('circle', { cx: 14.9, cy: 12.4, r: 1.9, fill: '#ffffff' }),
      );
    }

    /** A tiny close glyph, independent of icon fonts. */
    function CloseMark() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M4 4l8 8M12 4l-8 8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      );
    }

    /**
     * One SVG path covering every dark module — far cheaper than ~900 rects.
     * @param rows - matrix rows of "0"/"1".
     * @returns an SVG path `d` attribute.
     */
    function qrPath(rows) {
      let d = '';
      for (let row = 0; row < rows.length; row++) {
        const line = rows[row];
        for (let column = 0; column < line.length; column++) {
          if (line[column] === '1') d += 'M' + column + ' ' + row + 'h1v1h-1z';
        }
      }
      return d;
    }

    /** The scan target, drawn from the module matrix the Host encoded. */
    function QrImage(matrix) {
      const size = matrix.size;
      return h(
        'div',
        { className: 'dsh-bilibili-qrbox' },
        h(
          'svg',
          {
            className: 'dsh-bilibili-qr',
            viewBox: '0 0 ' + size + ' ' + size,
            shapeRendering: 'crispEdges',
            role: 'img',
            'aria-label': matrix.alt,
          },
          h('rect', { x: 0, y: 0, width: size, height: size, fill: '#ffffff' }),
          h('path', { d: qrPath(matrix.rows), fill: '#000000' }),
        ),
      );
    }

    /**
     * Avatar with a letter fallback when Bilibili gives no face URL.
     * `no-referrer` is required: the image CDN answers 403 to a foreign
     * Referer (measured).
     * @param profile - account projection.
     * @param size - rendered square size in px.
     */
    function Avatar(profile, size) {
      const dimension = { width: size, height: size };
      const face = profile && profile.face;
      if (face) {
        return h('img', {
          className: 'dsh-bilibili-avatar',
          style: dimension,
          src: face,
          alt: '',
          referrerPolicy: 'no-referrer',
          onError: (event) => {
            event.currentTarget.style.visibility = 'hidden';
          },
        });
      }
      const name = (profile && profile.name) || '';
      return h(
        'div',
        {
          className: 'dsh-bilibili-avatar',
          style: Object.assign(
            {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: Math.round(size * 0.42),
              color: 'var(--dsw-alias-label-secondary)',
            },
            dimension,
          ),
        },
        name.slice(0, 1) || '?',
      );
    }

    /** One line of the account summary under the name. */
    function summarize(t, profile, savedAt) {
      const parts = [];
      if (profile && profile.mid !== null && profile.mid !== undefined) {
        parts.push(t('uid') + ' ' + profile.mid);
      }
      if (profile && profile.level !== null && profile.level !== undefined) {
        parts.push(t('level') + ' ' + profile.level);
      }
      if (savedAt) parts.push(t('savedAt') + ' ' + new Date(savedAt).toLocaleString());
      return parts.join(' · ');
    }

    /** Seconds -> "m:ss" / "h:mm:ss". */
    function formatDuration(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return '';
      const total = Math.floor(seconds);
      const pad = (value) => (value < 10 ? '0' + value : String(value));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor(total / 60) % 60;
      const secs = total % 60;
      return (hours > 0 ? hours + ':' + pad(minutes) : String(minutes)) + ':' + pad(secs);
    }

    /** Play counts in the units a Chinese audience reads. */
    function formatCount(value) {
      if (!Number.isFinite(value) || value <= 0) return '0';
      if (value >= 100000000) return (value / 100000000).toFixed(1) + '亿';
      if (value >= 10000) return (value / 10000).toFixed(1) + '万';
      return String(Math.floor(value));
    }

    /**
     * One recommendation card. Clicking plays it inside the panel; the href
     * stays so middle-click / ctrl-click still opens it on bilibili.com.
     */
    function FeedCard(t, item, onOpen) {
      return h(
        'a',
        {
          key: item.bvid,
          className: 'dsh-bilibili-card',
          href: 'https://www.bilibili.com/video/' + item.bvid,
          target: '_blank',
          rel: 'noreferrer noopener',
          title: item.title + (item.author ? '  ·  ' + item.author : ''),
          'aria-label': t('feedOpen') + ': ' + item.title,
          onClick: (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            onOpen(item);
          },
        },
        h(
          'div',
          { className: 'dsh-bilibili-coverwrap' },
          item.cover
            ? h('img', {
                className: 'dsh-bilibili-cover',
                src: item.cover,
                alt: '',
                loading: 'lazy',
                referrerPolicy: 'no-referrer',
              })
            : h('div', { className: 'dsh-bilibili-cover' }),
          item.duration > 0
            ? h('span', { className: 'dsh-bilibili-duration' }, formatDuration(item.duration))
            : null,
        ),
        h('div', { className: 'dsh-bilibili-cardtitle' }, item.title),
        h(
          'div',
          { className: 'dsh-bilibili-cardmeta' },
          h('span', { className: 'dsh-bilibili-cardauthor' }, item.author),
          h('span', { className: 'dsh-bilibili-cardviews' }, formatCount(item.views)),
        ),
      );
    }

    /**
     * In-panel player. The Host resolves the stream and forwards the bytes, so
     * the <video> points at our own media route and Range requests work — which
     * is what makes seeking and resuming possible.
     * @param props - `t` seat, the feed item, and a back callback.
     */
    /** Idle helper for the append scheduler. */
    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** Fetch one byte range of a DASH track through our own media proxy. */
    async function fetchRange(url, from, to) {
      const response = await fetch(MEDIA + '?u=' + encodeURIComponent(url), {
        headers: { Range: 'bytes=' + from + '-' + to },
      });
      if (!response.ok) throw new Error('range fetch failed: HTTP ' + response.status);
      return response.arrayBuffer();
    }

    /** Append to a SourceBuffer and resolve once it has actually taken it. */
    function appendTo(sourceBuffer, bytes) {
      return new Promise((resolve, reject) => {
        const done = () => {
          sourceBuffer.removeEventListener('updateend', done);
          sourceBuffer.removeEventListener('error', failed);
          resolve();
        };
        const failed = () => {
          sourceBuffer.removeEventListener('updateend', done);
          sourceBuffer.removeEventListener('error', failed);
          reject(new Error('the media buffer rejected a fragment'));
        };
        sourceBuffer.addEventListener('updateend', done, { once: true });
        sourceBuffer.addEventListener('error', failed, { once: true });
        try {
          sourceBuffer.appendBuffer(bytes);
        } catch (error) {
          failed();
        }
      });
    }

    /** End of the last buffered range, or 0 before anything is buffered. */
    function bufferedEnd(sourceBuffer) {
      const ranges = sourceBuffer.buffered;
      return ranges.length === 0 ? 0 : ranges.end(ranges.length - 1);
    }

    /** Which fragment covers a point in time (linear: at most a few hundred). */
    function segmentIndexAt(track, seconds) {
      const segments = track.segments;
      for (let i = 0; i < segments.length; i++) {
        if (seconds < segments[i].t1) return i;
      }
      return Math.max(0, segments.length - 1);
    }

    /** How many seconds of media to keep appended ahead of the playhead. */
    const DASH_AHEAD_SECONDS = 25;
    /** How much to drop behind the playhead, so the buffer cannot grow forever. */
    const DASH_KEEP_BEHIND_SECONDS = 30;

    /**
     * Check the browser can actually decode this DASH manifest. Better to know
     * here, before tearing the <video> element's source out from under it.
     */
    function canPlayDash(descriptor) {
      if (typeof MediaSource === 'undefined') return false;
      const one = (track) =>
        track == null ||
        MediaSource.isTypeSupported(track.mimeType + '; codecs="' + track.codecs + '"');
      try {
        return one(descriptor.video) && one(descriptor.audio);
      } catch (error) {
        return false;
      }
    }

    /**
     * Play a DASH manifest through MSE.
     *
     * Bilibili only serves above 720P as DASH, whose media is a single file
     * addressed by byte ranges (`SegmentBase`): the Host parses the sidx and
     * hands over the byte range of every fragment, so this only has to fetch
     * ranges, append them, and keep a window ahead of the playhead. Seeking is
     * the browser's own, as long as the target fragment is appended.
     *
     * @param videoEl - the <video> to drive.
     * @param descriptor - the Host's DASH descriptor.
     * @param onError - called when the pipeline gives up.
     * @returns a handle with `stop()`.
     */
    function startDash(videoEl, descriptor, onError) {
      const source = new MediaSource();
      const objectUrl = URL.createObjectURL(source);
      let stopped = false;

      const states = [descriptor.video, descriptor.audio]
        .filter(Boolean)
        .map((track) => ({
          track,
          buffer: null,
          next: 0,
          primed: false,
          appended: new Set(),
        }));

      async function pump(state) {
        while (!stopped) {
          if (state.next >= state.track.segments.length) return;
          if (bufferedEnd(state.buffer) - (videoEl.currentTime || 0) > DASH_AHEAD_SECONDS) {
            await wait(800);
            continue;
          }
          if (state.buffer.updating) {
            await wait(120);
            continue;
          }
          try {
            if (!state.primed) {
              const init = await fetchRange(state.track.url, 0, state.track.initEnd);
              if (stopped) return;
              await appendTo(state.buffer, init);
              state.primed = true;
              continue;
            }
            const index = state.next;
            if (state.appended.has(index)) {
              state.next = index + 1;
              continue;
            }
            const segment = state.track.segments[index];
            const from = state.track.mediaStart + segment.off;
            const bytes = await fetchRange(state.track.url, from, from + segment.len - 1);
            if (stopped) return;
            await appendTo(state.buffer, bytes);
            state.appended.add(index);
            state.next = index + 1;
          } catch (error) {
            if (stopped) return;
            onError(error);
            return;
          }
        }
      }

      // A seek just moves the append window; already-buffered data stays put,
      // which is what makes seeking back and forth instant.
      const onSeeking = () => {
        const target = videoEl.currentTime;
        for (const state of states) {
          state.next = segmentIndexAt(state.track, target);
          if (state.buffer === null || state.buffer.updating) continue;
          const dropTo = Math.max(0, target - DASH_KEEP_BEHIND_SECONDS);
          if (dropTo > 1) {
            try {
              state.buffer.remove(0, dropTo);
            } catch (error) {
              /* a failed eviction is harmless; the quota path will retry */
            }
          }
        }
      };

      source.addEventListener('sourceopen', () => {
        try {
          for (const state of states) {
            const mime = state.track.mimeType + '; codecs="' + state.track.codecs + '"';
            state.buffer = source.addSourceBuffer(mime);
            state.buffer.mode = 'segments';
          }
        } catch (error) {
          onError(error);
          return;
        }
        videoEl.addEventListener('seeking', onSeeking);
        for (const state of states) void pump(state);
      });

      videoEl.src = objectUrl;
      videoEl.load();

      return {
        stop() {
          stopped = true;
          videoEl.removeEventListener('seeking', onSeeking);
          try {
            if (source.readyState === 'open') source.endOfStream();
          } catch (error) {
            /* already closed */
          }
          try {
            videoEl.removeAttribute('src');
            videoEl.load();
          } catch (error) {
            /* element already gone */
          }
          URL.revokeObjectURL(objectUrl);
        },
      };
    }

    function Player(props) {
      const t = props.t;
      const item = props.item;
      const [state, setState] = React.useState({ status: 'loading' });
      // Same reason as elsewhere: the effect must key on the video, not on a
      // locale seat that the renderer may hand out again.
      const tRef = React.useRef(t);
      React.useEffect(() => {
        tRef.current = t;
      });
      const videoRef = React.useRef(null);
      const engineRef = React.useRef(null);

      // Resolve a source: DASH first so the viewer gets the real ceiling, then
      // the progressive mp4 path when MSE cannot take the stream. `qn` 0 means
      // "the highest this account may have".
      const resolve = React.useCallback(
        async (qn, resumeAt) => {
          if (engineRef.current !== null) {
            engineRef.current.stop();
            engineRef.current = null;
          }
          setState({ status: 'loading' });
          const suffix =
            '?bvid=' + encodeURIComponent(item.bvid) +
            '&cid=' + encodeURIComponent(item.cid) +
            (qn > 0 ? '&qn=' + qn : '');
          try {
            let dash = null;
            try {
              const payload = await callHost('GET', undefined, DASH + suffix);
              if (payload.ok && payload.video) dash = payload;
            } catch (error) {
              dash = null;
            }
            if (dash !== null && canPlayDash(dash)) {
              setState({
                status: 'ready',
                mode: 'dash',
                descriptor: dash,
                qualities: dash.qualities || [],
                quality: dash.quality || 0,
                qualityLabel: dash.qualityLabel || '',
                resumeAt: resumeAt > 0 ? resumeAt : 0,
              });
              return;
            }
            const payload = await callHost('GET', undefined, PLAY + suffix);
            if (!payload.ok) {
              throw new Error(payload.error || tRef.current('playFailed'));
            }
            setState({
              status: 'ready',
              mode: 'mp4',
              stream: payload.stream,
              qualities: payload.qualities || [],
              quality: payload.quality || 0,
              qualityLabel: payload.qualityLabel || '',
              note: dash === null ? '' : tRef.current('qualityFellBack'),
              resumeAt: resumeAt > 0 ? resumeAt : 0,
            });
          } catch (cause) {
            setState({ status: 'error', error: String((cause && cause.message) || cause) });
          }
        },
        [item.bvid, item.cid],
      );

      React.useEffect(() => {
        resolve(0, 0);
      }, [resolve]);

      // Drive MSE once the descriptor is in, and tear it down on any change.
      React.useEffect(() => {
        if (state.status !== 'ready' || state.mode !== 'dash') return undefined;
        const element = videoRef.current;
        if (element === null) return undefined;
        const applyResume = () => {
          if (state.resumeAt > 0 && Math.abs(element.currentTime - state.resumeAt) > 0.5) {
            try {
              element.currentTime = state.resumeAt;
            } catch (error) {
              /* the source may not be seekable yet */
            }
          }
        };
        element.addEventListener('loadedmetadata', applyResume, { once: true });
        let engine = null;
        try {
          engine = startDash(element, state.descriptor, (error) => {
            setState({
              status: 'error',
              error: String((error && error.message) || error),
            });
          });
          engineRef.current = engine;
        } catch (error) {
          setState({
            status: 'error',
            error: 'DASH playback failed: ' + String((error && error.message) || error),
          });
        }
        return () => {
          element.removeEventListener('loadedmetadata', applyResume);
          if (engine !== null) engine.stop();
          engineRef.current = null;
        };
      }, [state.status, state.mode, state.descriptor]);

      // Keep the position when the source is swapped (mp4 quality switch).
      const onLoadedMetadata = () => {
        const element = videoRef.current;
        if (
          element !== null &&
          state.resumeAt > 0 &&
          Math.abs(element.currentTime - state.resumeAt) > 0.5
        ) {
          element.currentTime = state.resumeAt;
        }
      };

      const switchQuality = (qn) => {
        const element = videoRef.current;
        resolve(qn, element !== null ? element.currentTime : 0);
      };

      const frame =
        state.status === 'ready'
          ? h('video', {
              ref: videoRef,
              className: 'dsh-bilibili-video',
              src: state.mode === 'mp4' ? state.stream : undefined,
              controls: true,
              autoPlay: true,
              playsInline: true,
              preload: 'metadata',
              onLoadedMetadata: state.mode === 'mp4' ? onLoadedMetadata : undefined,
            })
          : h(
              'div',
              { className: 'dsh-bilibili-videofallback' },
              h(
                'span',
                {
                  className:
                    state.status === 'error' ? 'dsh-bilibili-error' : 'dsh-bilibili-note',
                },
                state.status === 'error'
                  ? t('playFailed') + '：' + state.error
                  : t('playLoading'),
              ),
            );

      // Only worth showing when there is a real choice to make.
      const qualities = state.qualities || [];
      const picker =
        qualities.length > 1
          ? h(
              'select',
              {
                className: 'dsh-bilibili-quality',
                value: String(state.quality || ''),
                title: t('quality'),
                'aria-label': t('quality'),
                disabled: state.status !== 'ready',
                onChange: (event) => switchQuality(Number(event.target.value)),
              },
              qualities.map((entry) =>
                h('option', { key: entry.qn, value: String(entry.qn) }, entry.label),
              ),
            )
          : null;

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dsh-bilibili-feedbar' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-bilibili-ghost dsh-bilibili-tiny',
              onClick: props.onBack,
            },
            '← ' + t('back'),
          ),
          h('span', { className: 'dsh-bilibili-spacer' }),
          picker,
        ),
        state.note ? h('div', { className: 'dsh-bilibili-note' }, state.note) : null,
        h('div', { className: 'dsh-bilibili-videowrap' }, frame),
        h('div', { className: 'dsh-bilibili-videotitle', title: item.title }, item.title),
        h(
          'div',
          { className: 'dsh-bilibili-cardmeta' },
          h('span', null, formatCount(item.views) + ' 播放'),
          h('span', null, formatDuration(item.duration)),
          h('span', { className: 'dsh-bilibili-cardauthor' }, item.author),
        ),
      );
    }

    /**
     * Scan-to-login: ask the Host half for a Bilibili QR, then poll until the
     * phone confirms it.
     * @param props - `t` seat plus `onLoggedIn`, called with the session body.
     */
    function QrLogin(props) {
      const t = props.t;
      // Both the callback and the locale seat are held in refs so the polling
      // effect depends on `attempt` alone: a new `t` seat must not restart the
      // poll loop (which would issue a fresh QR request every render).
      const loggedIn = React.useRef(props.onLoggedIn);
      const tRef = React.useRef(t);
      React.useEffect(() => {
        tRef.current = t;
      });
      React.useEffect(() => {
        loggedIn.current = props.onLoggedIn;
      });
      const [phase, setPhase] = React.useState('loading');
      const [matrix, setMatrix] = React.useState(null);
      const [message, setMessage] = React.useState(null);
      const [attempt, setAttempt] = React.useState(0);

      React.useEffect(() => {
        let cancelled = false;
        let key = null;
        let timer = null;

        const stop = () => {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
        };

        const failure = (cause) => {
          if (cancelled) return;
          stop();
          setPhase('error');
          setMessage(String((cause && cause.message) || cause));
        };

        const tick = async () => {
          if (cancelled || key === null) return;
          try {
            const result = await callHost(
              'GET',
              undefined,
              LOGIN_POLL + '?key=' + encodeURIComponent(key),
            );
            if (cancelled) return;
            if (result.status === 'ok') {
              stop();
              setPhase('ok');
              if (typeof loggedIn.current === 'function') loggedIn.current(result);
            } else if (result.status === 'scanned') {
              setPhase('scanned');
            } else if (result.status === 'expired' || result.status === 'stale') {
              stop();
              setPhase('expired');
            } else if (result.status === 'error') {
              stop();
              setPhase('error');
              setMessage(result.error || null);
            } else {
              setPhase('waiting');
            }
          } catch (cause) {
            failure(cause);
          }
        };

        const start = async () => {
          setPhase('loading');
          setMessage(null);
          try {
            const issued = await callHost('GET', undefined, LOGIN_QRCODE);
            if (cancelled) return;
            if (!issued.ok) throw new Error(issued.error || 'QR request refused');
            key = issued.key;
            setMatrix({ size: issued.size, rows: issued.matrix, alt: tRef.current('qrAlt') });
            setPhase('waiting');
            timer = setInterval(tick, 2000);
          } catch (cause) {
            failure(cause);
          }
        };

        start();
        return () => {
          cancelled = true;
          stop();
        };
      }, [attempt]);

      const caption = () => {
        if (phase === 'loading') return t('qrLoading');
        if (phase === 'scanned') return t('qrScanned');
        if (phase === 'expired') return t('qrExpired');
        if (phase === 'error') return message || t('failed');
        return t('qrWaiting');
      };

      return h(
        React.Fragment,
        null,
        matrix === null ? null : QrImage(matrix),
        h('div', { className: 'dsh-bilibili-note' }, caption()),
        phase === 'expired' || phase === 'error'
          ? h(
              'div',
              { className: 'dsh-bilibili-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-bilibili-ghost',
                  onClick: () => setAttempt((n) => n + 1),
                },
                phase === 'expired' ? t('qrRefresh') : t('retry'),
              ),
            )
          : null,
      );
    }

    /**
     * Signed-out panel: scan by default, with the paste form as the fallback.
     * @param props - `t`, the session snapshot, and the parent's callbacks.
     */
    function LoginPanel(props) {
      const t = props.t;
      const session = props.session;
      const [mode, setMode] = React.useState('qr');
      const [draft, setDraft] = React.useState('');
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);

      if (session.phase === 'loading') {
        return h('div', { className: 'dsh-bilibili-note' }, t('loading'));
      }

      if (session.phase === 'error') {
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dsh-bilibili-error' },
            session.needsRestart ? t('needsRestart') : t('failed') + '：' + session.error,
          ),
          h(
            'div',
            { className: 'dsh-bilibili-actions' },
            h(
              'button',
              { type: 'button', className: 'dsh-bilibili-ghost', onClick: props.onReload },
              t('retry'),
            ),
          ),
        );
      }

      const shown =
        error || (session.reason === 'expired' ? t('expired') : session.error) || null;

      const save = async () => {
        if (draft.trim() === '' || busy) return;
        setBusy(true);
        setError(null);
        try {
          const payload = await callHost('POST', { cookie: draft });
          if (payload.ok && payload.loggedIn) {
            setDraft('');
            props.onAdopt(payload);
          } else {
            setError(t('failed') + '：' + (payload.error || ''));
          }
        } catch (cause) {
          setError(t('failed') + '：' + String((cause && cause.message) || cause));
        } finally {
          setBusy(false);
        }
      };

      const failure =
        shown === null ? null : h('div', { className: 'dsh-bilibili-error' }, shown);
      const manual = mode === 'manual';

      return h(
        React.Fragment,
        null,
        manual
          ? h(
              React.Fragment,
              null,
              h('div', { className: 'dsh-bilibili-note' }, t('hint')),
              h(
                'label',
                { className: 'dsh-bilibili-field', htmlFor: 'dsh-bilibili-cookie' },
                t('cookieLabel'),
              ),
              h('textarea', {
                id: 'dsh-bilibili-cookie',
                className: 'dsh-bilibili-input',
                value: draft,
                placeholder: t('cookiePlaceholder'),
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => setDraft(event.target.value),
              }),
            )
          : h(QrLogin, { t, onLoggedIn: props.onAdopt }),
        failure,
        manual
          ? h(
              'div',
              { className: 'dsh-bilibili-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-bilibili-primary',
                  onClick: save,
                  disabled: busy || draft.trim() === '',
                },
                busy ? t('saving') : t('save'),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dsh-bilibili-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-bilibili-link',
              onClick: () => setMode(manual ? 'qr' : 'manual'),
            },
            manual ? t('qrSwitch') : t('manualSwitch'),
          ),
        ),
        h('div', { className: 'dsh-bilibili-risk' }, t('risk')),
      );
    }

    /**
     * Signed-in panel: one batch of Bilibili recommendations.
     *
     * `fresh_idx` selects the batch and Bilibili answers the same batch for the
     * same index within a short window (measured), so 换一批 walks the index
     * while 刷新 re-reads the batch currently on screen.
     * @param props - `t` seat.
     */
    function FeedPanel(props) {
      const t = props.t;
      const [items, setItems] = React.useState([]);
      const [status, setStatus] = React.useState('loading');
      const [busy, setBusy] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [needsRestart, setNeedsRestart] = React.useState(false);
      const [view, setView] = React.useState('rcmd');
      const [heading, setHeading] = React.useState('');
      const [hasMore, setHasMore] = React.useState(true);
      const [draft, setDraft] = React.useState('');
      const [playing, setPlaying] = React.useState(null);
      // The request behind what is on screen, so 刷新 and 换一批 advance the
      // view the user is actually looking at.
      const requestRef = React.useRef({ view: 'rcmd', page: 1 });
      // The locale seat is re-derived by the renderer, so it is read through a
      // ref: a `load` that depended on `t` would change identity whenever the
      // renderer handed out a new seat, re-firing the effect below and
      // refetching batch 1 over the batch the user just asked for.
      const tRef = React.useRef(t);
      React.useEffect(() => {
        tRef.current = t;
      });

      const load = React.useCallback(async (request, action) => {
        setBusy(action);
        setError(null);
        try {
          let url;
          if (request.view === 'rcmd') {
            url = FEED + '?cursor=' + (request.page || 1);
          } else if (request.view === 'history') {
            const cursor = request.cursor || {};
            url =
              LIBRARY + '/history?max=' + (cursor.max || 0) +
              '&viewAt=' + (cursor.viewAt || 0) +
              '&business=' + encodeURIComponent(cursor.business || '');
          } else if (request.view === 'fav') {
            url = LIBRARY + '/fav?page=' + (request.page || 1);
          } else {
            url =
              LIBRARY + '/search?keyword=' + encodeURIComponent(request.keyword || '') +
              '&page=' + (request.page || 1);
          }
          const payload = await callHost('GET', undefined, url);
          if (!payload.ok) {
            const failure = new Error(payload.error || tRef.current('feedFailed'));
            failure.status = 502;
            throw failure;
          }
          requestRef.current = {
            view: request.view,
            page: payload.page || request.page || 1,
            cursor: payload.cursor || request.cursor || null,
            keyword: request.keyword || '',
          };
          setItems(payload.items || []);
          setView(request.view);
          setHeading(
            request.view === 'search'
              ? tRef.current('searchTitle') + (request.keyword || '')
              : request.view === 'history'
                ? tRef.current('historyBtn')
                : request.view === 'fav'
                  ? payload.folder || tRef.current('favBtn')
                  : payload.personalised === true
                    ? tRef.current('feedForYou')
                    : tRef.current('feedGeneral'),
          );
          setHasMore(payload.hasMore === true);
          setStatus('ready');
          setNeedsRestart(false);
        } catch (cause) {
          setStatus('error');
          setNeedsRestart(cause && cause.status === 404);
          setError(String((cause && cause.message) || cause));
        } finally {
          setBusy(null);
        }
      }, []);

      React.useEffect(() => {
        load({ view: 'rcmd', page: 1 }, 'refresh');
      }, [load]);

      if (playing !== null) {
        return h(Player, { t, item: playing, onBack: () => setPlaying(null) });
      }

      const openView = (target) => {
        if (requestRef.current.view === target.view) {
          load({ view: 'rcmd', page: 1 }, 'refresh');
          return;
        }
        load(target, 'next');
      };

      const nextPage = () => {
        const current = requestRef.current;
        if (current.view === 'history') {
          load({ view: 'history', cursor: current.cursor }, 'next');
          return;
        }
        load(
          {
            view: current.view,
            keyword: current.keyword,
            page: (current.page || 1) + 1,
          },
          'next',
        );
      };

      const submitSearch = () => {
        const keyword = draft.trim();
        if (keyword === '') return;
        load({ view: 'search', keyword, page: 1 }, 'search');
      };

      const searchRow = h(
        'div',
        { className: 'dsh-bilibili-search' },
        h('input', {
          className: 'dsh-bilibili-input dsh-bilibili-searchinput',
          type: 'search',
          value: draft,
          placeholder: t('searchPlaceholder'),
          'aria-label': t('searchPlaceholder'),
          spellCheck: false,
          autoComplete: 'off',
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitSearch();
            }
          },
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-bilibili-ghost dsh-bilibili-tiny',
            onClick: submitSearch,
            disabled: busy !== null || draft.trim() === '',
          },
          t('searchAction'),
        ),
      );

      const chip = (active, label, onClick) =>
        h(
          'button',
          {
            type: 'button',
            className:
              'dsh-bilibili-ghost dsh-bilibili-tiny' + (active ? ' dsh-bilibili-on' : ''),
            disabled: busy !== null,
            'aria-pressed': active,
            onClick,
          },
          label,
        );

      const bar = h(
        'div',
        { className: 'dsh-bilibili-feedbar' },
        h('span', { className: 'dsh-bilibili-feedtitle', title: heading }, heading),
        h('span', { className: 'dsh-bilibili-spacer' }),
        chip(view === 'history', t('historyBtn'), () => openView({ view: 'history' })),
        chip(view === 'fav', t('favBtn'), () => openView({ view: 'fav', page: 1 })),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-bilibili-ghost dsh-bilibili-tiny',
            disabled: busy !== null || (view !== 'rcmd' && hasMore === false),
            onClick: nextPage,
          },
          busy === 'next'
            ? t('loadingNext')
            : view === 'rcmd'
              ? t('feedNext')
              : t('nextPage'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-bilibili-ghost dsh-bilibili-tiny',
            disabled: busy !== null,
            onClick: () => load(requestRef.current, 'refresh'),
          },
          busy === 'refresh' ? t('reloading') : t('feedRefresh'),
        ),
      );

      const failure =
        status !== 'error'
          ? null
          : h(
              'div',
              { className: 'dsh-bilibili-error' },
              needsRestart ? t('needsRestart') : t('feedFailed') + '：' + error,
            );

      let body;
      if (status === 'loading' && items.length === 0) {
        body = h('div', { className: 'dsh-bilibili-note' }, t('feedLoading'));
      } else if (items.length === 0) {
        body = h('div', { className: 'dsh-bilibili-note' }, t('feedEmpty'));
      } else {
        body = h(
          'div',
          { className: 'dsh-bilibili-grid' },
          items.map((item) => FeedCard(t, item, setPlaying)),
        );
      }

      return h(
        React.Fragment,
        null,
        searchRow,
        bar,
        failure,
        body,
        status === 'error' && items.length === 0
          ? h(
              'div',
              { className: 'dsh-bilibili-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-bilibili-ghost',
                  onClick: () => load({ view: 'rcmd', page: 1 }, 'refresh'),
                },
                t('retry'),
              ),
            )
          : null,
      );
    }

    /**
     * The docked widget. `open` is component-local: closing hides the card and
     * leaves the launcher in its place. The session snapshot lives HERE rather
     * than inside the panel, because the collapsed launcher has to show whether
     * an account is connected.
     * @param props - receives the synthesized `t` seat.
     */
    function Widget(props) {
      const t = props.t;
      const [open, setOpen] = React.useState(true);
      const [session, setSession] = React.useState({ phase: 'loading' });

      const adopt = React.useCallback((payload) => {
        if (payload && payload.loggedIn) {
          setSession({
            phase: 'in',
            profile: payload.profile || null,
            savedAt: payload.savedAt || null,
          });
        } else {
          setSession({
            phase: 'out',
            reason: (payload && payload.reason) || null,
            error: (payload && payload.error) || null,
            savedAt: (payload && payload.savedAt) || null,
          });
        }
      }, []);

      const load = React.useCallback(async () => {
        setSession({ phase: 'loading' });
        try {
          adopt(await callHost('GET'));
        } catch (cause) {
          setSession({
            phase: 'error',
            needsRestart: cause && cause.status === 404,
            error: String((cause && cause.message) || cause),
          });
        }
      }, [adopt]);

      React.useEffect(() => {
        load();
      }, [load]);

      const forget = React.useCallback(async () => {
        try {
          adopt(await callHost('DELETE'));
        } catch (cause) {
          setSession({
            phase: 'error',
            error: String((cause && cause.message) || cause),
          });
        }
      }, [adopt]);

      const signedIn = session.phase === 'in' && session.profile !== null;
      const name = signedIn ? session.profile.name || '' : '';

      const header = h(
        'header',
        { className: 'dsh-bilibili-head' },
        signedIn
          ? h(
              'div',
              { className: 'dsh-bilibili-brand' },
              Avatar(session.profile, 26),
              h(
                'div',
                { className: 'dsh-bilibili-whose' },
                h('div', { className: 'dsh-bilibili-uname', title: name }, name),
                h(
                  'div',
                  { className: 'dsh-bilibili-meta' },
                  summarize(t, session.profile, null),
                ),
              ),
            )
          : h(
              'div',
              { className: 'dsh-bilibili-brand' },
              h('span', { className: 'dsh-bilibili-icon' }, BrandMark(16)),
              h('span', { className: 'dsh-bilibili-name' }, 'dsh-bilibili'),
            ),
        signedIn
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-bilibili-btn dsh-bilibili-textbtn',
                title: t('logout'),
                'aria-label': t('logout'),
                onClick: forget,
              },
              t('logout'),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-bilibili-btn',
            title: t('close'),
            'aria-label': t('close'),
            onClick: () => setOpen(false),
          },
          CloseMark(),
        ),
      );

      const panel = h(
        'section',
        { className: 'dsh-bilibili-panel', 'aria-label': 'dsh-bilibili' },
        header,
        h(
          'div',
          { className: 'dsh-bilibili-body' },
          session.phase === 'in'
            ? h(FeedPanel, { t })
            : h(LoginPanel, { t, session, onAdopt: adopt, onReload: load }),
        ),
      );

      const launcher = h(
        'button',
        {
          type: 'button',
          className: 'dsh-bilibili-launcher',
          title: signedIn ? name + ' · ' + t('open') : t('open'),
          'aria-label': signedIn ? t('account') + ': ' + name : t('open'),
          onClick: () => setOpen(true),
        },
        signedIn ? Avatar(session.profile, 30) : BrandMark(22),
      );

      return h(
        React.Fragment,
        null,
        h('style', { key: 'css' }, CSS),
        h('div', { className: 'dsh-bilibili-dock' }, open ? panel : launcher),
      );
    }

    return {
      inject: ['locale', 'slots'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICTS.zh), 'dsh-bilibili: locale zh');
        ctx.effect(() => ctx.locale.register(NS, 'en', DICTS.en), 'dsh-bilibili: locale en');
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: NS,
              order: 50,
              locale: NS,
              label: 'dsh-bilibili',
            },
            Widget,
          ),
        );
      },
    };
  },
});
