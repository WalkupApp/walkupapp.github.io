/**
 * Shared helpers for /player/ and /share/ deep-link landing pages.
 * Canonical host: https://walkupsongs.app
 * Payload rules match Android ShareablePlayer.kt / ExportableTeam.
 */
(function (global) {
  'use strict';

  var IOS_STORE = 'https://apps.apple.com/app/walk-up-songs/id6760240442';
  var ANDROID_STORE = 'https://play.google.com/store/apps/details?id=com.walkupsongs.app';
  var ANDROID_PACKAGE = 'com.walkupsongs.app';

  function normalizeBase64(encoded) {
    if (!encoded) return '';
    var s = String(encoded).replace(/\s/g, '+').replace(/-/g, '+').replace(/_/g, '/');
    var pad = s.length % 4;
    if (pad) s += Array(5 - pad).join('=');
    return s;
  }

  function base64ToUint8Array(base64) {
    var binary = atob(normalizeBase64(base64));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function inflateRawBase64(base64) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.resolve(null);
    }
    try {
      var bytes = base64ToUint8Array(base64);
      var ds = new DecompressionStream('deflate-raw');
      var writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      return new Response(ds.readable).text().then(tryParseJson).catch(function () {
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  /**
   * Decode share `data` query param.
   * v=2 → raw DEFLATE then JSON.
   * Otherwise: try plain Base64 JSON, then inflate (Android auto-detect parity).
   */
  function decodeSharePayload(encoded, version) {
    if (!encoded) return Promise.resolve(null);
    var forceV2 = version === '2' || version === 2;

    if (forceV2) {
      return inflateRawBase64(encoded);
    }

    try {
      var plain = tryParseJson(atob(normalizeBase64(encoded)));
      if (plain) return Promise.resolve(plain);
    } catch (e) { /* fall through */ }

    return inflateRawBase64(encoded);
  }

  function detectPlatform() {
    var ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return 'ios';
    }
    return 'other';
  }

  function queryString() {
    return window.location.search || '';
  }

  /** Custom-scheme open URL preserving query (data / v). */
  function customSchemeUrl(kind) {
    // walkupsongs://player/?data=…  or  walkupsongs://share/?v=2&data=…
    var qs = queryString();
    if (!qs) qs = '';
    return 'walkupsongs://' + kind + '/' + qs;
  }

  /** Android Chrome Intent URL falling back to Play Store. */
  function androidIntentUrl(kind) {
    var qs = queryString().replace(/^\?/, '');
    var path = kind + '/';
    var fallback = encodeURIComponent(ANDROID_STORE);
    return 'intent://' + path + (qs ? '?' + qs : '') +
      '#Intent;scheme=walkupsongs;package=' + ANDROID_PACKAGE +
      ';S.browser_fallback_url=' + fallback + ';end';
  }

  /**
   * Attempt to hand off to the native app. Call once on load.
   * Shows no error UI; store fallback is the page’s responsibility.
   *
   * iOS: Universal Links should intercept before this page; if we are here,
   * try custom-scheme once. Do NOT auto top-level navigate on iOS (Safari often
   * shows an error interstitial and drops the query). Prefer the Open button.
   */
  function tryOpenApp(kind) {
    var platform = detectPlatform();
    var schemeUrl = customSchemeUrl(kind);

    // Hidden iframe avoids some browsers replacing the landing page on failure.
    try {
      var iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = schemeUrl;
      document.body.appendChild(iframe);
      setTimeout(function () {
        try { document.body.removeChild(iframe); } catch (e) { /* ignore */ }
      }, 2000);
    } catch (e) { /* ignore */ }

    if (platform === 'android') {
      // Intent URLs work best via top-level navigation on Android Chrome.
      setTimeout(function () {
        window.location.href = androidIntentUrl(kind);
      }, 50);
    }
    // iOS: leave landing visible; user taps "Open in WalkUp Songs" → openAppNow.
  }

  function openAppNow(kind) {
    var platform = detectPlatform();
    window.location.href = platform === 'android' ? androidIntentUrl(kind) : customSchemeUrl(kind);
  }

  function applyStorePriority(iosBtn, playBtn) {
    var platform = detectPlatform();
    if (!iosBtn || !playBtn) return;
    if (platform === 'android') {
      playBtn.classList.add('primary');
      iosBtn.classList.remove('primary');
      playBtn.parentNode.insertBefore(playBtn, iosBtn);
    } else if (platform === 'ios') {
      iosBtn.classList.add('primary');
      playBtn.classList.remove('primary');
      iosBtn.parentNode.insertBefore(iosBtn, playBtn);
    }
  }

  global.WalkUpShareLanding = {
    IOS_STORE: IOS_STORE,
    ANDROID_STORE: ANDROID_STORE,
    decodeSharePayload: decodeSharePayload,
    detectPlatform: detectPlatform,
    customSchemeUrl: customSchemeUrl,
    tryOpenApp: tryOpenApp,
    openAppNow: openAppNow,
    applyStorePriority: applyStorePriority,
    queryString: queryString
  };
})(window);
