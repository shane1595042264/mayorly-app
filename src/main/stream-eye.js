// Mayorly stream eye. While Mayorly says a stream rule is running ("the streamer dies"), it reads
// this page's own video twice a second and hands Mayorly, on this computer, a grid of colour and
// light: 32 x 18 cells, three numbers each. Never your screen, never a picture. Otherwise it only
// says hello every few seconds while a video plays, so Mayorly knows the tab is there.

/** RGBA pixels of a w x h frame in; per cell of a 32 x 18 grid: colourfulness, brightness, lit share. */
function mayorlyGrid(data, w, h) {
  var GW = 32
  var GH = 18
  var chroma = new Uint8Array(GW * GH)
  var luma = new Uint8Array(GW * GH)
  var lit = new Uint8Array(GW * GH)
  var cw = w / GW
  var ch = h / GH
  for (var r = 0; r < GH; r++) {
    var y0 = Math.round(r * ch)
    var y1 = Math.round((r + 1) * ch)
    for (var c = 0; c < GW; c++) {
      var x0 = Math.round(c * cw)
      var x1 = Math.round((c + 1) * cw)
      var n = 0
      var nl = 0
      var sumL = 0
      var sumC = 0
      for (var y = y0; y < y1; y++) {
        var row = y * w * 4
        for (var x = x0; x < x1; x++) {
          var i = row + x * 4
          var R = data[i]
          var G = data[i + 1]
          var B = data[i + 2]
          var mx = R > G ? (R > B ? R : B) : G > B ? G : B
          var mn = R < G ? (R < B ? R : B) : G < B ? G : B
          sumL += 0.299 * R + 0.587 * G + 0.114 * B
          n++
          if (mx >= 40) {
            nl++
            sumC += mx - mn
          }
        }
      }
      var k = r * GW + c
      luma[k] = n ? Math.round(sumL / n) : 0
      lit[k] = n ? Math.round((255 * nl) / n) : 0
      chroma[k] = nl && nl >= 0.2 * n ? Math.round(sumC / nl) : 0
    }
  }
  return { chroma: chroma, luma: luma, lit: lit }
}

if (typeof chrome === 'object' && chrome && chrome.runtime && chrome.runtime.id) {
  ;(function () {
    var V = 1
    var W = 320
    var H = 180
    var HELLO = 5000
    var host = location.hostname
    var site = /(^|\.)twitch\.tv$/.test(host)
      ? 'twitch'
      : /(^|\.)youtube\.com$/.test(host)
        ? 'youtube'
        : /(^|\.)kick\.com$/.test(host)
          ? 'kick'
          : /(^|\.)bilibili\.com$/.test(host)
            ? 'bilibili'
            : /(^|\.)huya\.com$/.test(host)
              ? 'huya'
              : /(^|\.)douyu\.com$/.test(host)
                ? 'douyu'
                : null
    if (!site) return
    var armed = false
    var every = 500
    var stopped = false
    // Videos the page will not let be read (from another origin), skipped; another on the page can still be.
    var bad = new WeakSet()
    var tainted = false
    var lastTime = -1
    var lastHello = 0
    var costs = []
    var cost = null
    var canvas = null
    var g = null

    var b64 = function (a) {
      var s = ''
      for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i])
      return btoa(s)
    }
    // The game the page says it shows, where the page says it.
    var category = function () {
      var el = site === 'twitch' ? document.querySelector('[data-a-target="stream-game-link"]') : site === 'kick' ? document.querySelector('a[href^="/category/"]') : null
      return el ? (el.textContent || '').trim().slice(0, 80) : null
    }
    var ad = function () {
      var el = document.querySelector('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], .html5-video-player.ad-showing')
      return !!el && el.getClientRects().length > 0
    }
    var visible = function () {
      return document.visibilityState === 'visible' || !!document.pictureInPictureElement
    }
    // The stream: the biggest playing video on screen, wide like a game. One that cannot be read
    // only when there is no other, so Mayorly hears that it cannot.
    var video = function () {
      var best = null
      var area = 0
      var unread = null
      var vs = document.querySelectorAll('video')
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i]
        if (v.paused || v.ended || v.readyState < 2 || v.videoWidth < 320 || !v.videoHeight) continue
        if (bad.has(v)) {
          unread = v
          continue
        }
        var aspect = v.videoWidth / v.videoHeight
        if (aspect < 1.6 || aspect > 1.9) continue
        var rc = v.getBoundingClientRect()
        var a = Math.max(0, Math.min(rc.right, innerWidth) - Math.max(rc.left, 0)) * Math.max(0, Math.min(rc.bottom, innerHeight) - Math.max(rc.top, 0))
        if (a > area || (document.pictureInPictureElement === v && !best)) {
          best = v
          area = a
        }
      }
      if (best) return { v: best, area: Math.round(area), bad: false }
      return unread ? { v: unread, area: 0, bad: true } : null
    }
    var post = function (m) {
      return new Promise(function (resolve) {
        try {
          var msg = { mayorly: 'stream', v: V, site: site, title: document.title, category: category(), visible: visible(), ad: ad(), cost: cost }
          for (var k in m) msg[k] = m[k]
          chrome.runtime.sendMessage(msg, function (r) {
            if (chrome.runtime.lastError) return resolve(null)
            resolve(r || null)
          })
        } catch (e) {
          // The extension was reloaded: this copy of the script is orphaned and stops.
          stopped = true
          resolve(null)
        }
      })
    }
    var sample = function (v) {
      if (!canvas) {
        canvas = new OffscreenCanvas(W, H)
        g = canvas.getContext('2d', { willReadFrequently: true })
      }
      var t0 = performance.now()
      g.drawImage(v, 0, 0, W, H)
      var px
      try {
        px = g.getImageData(0, 0, W, H).data
      } catch (e) {
        // A video from another origin: the page will not let it be read. Skip it from now on, and
        // start a clean canvas, since this one can no longer be read either.
        bad.add(v)
        canvas = null
        tainted = true
        return null
      }
      var grid = mayorlyGrid(px, W, H)
      costs.push(performance.now() - t0)
      if (costs.length >= 20) {
        cost = Math.round((costs.reduce(function (a, b) { return a + b }, 0) / costs.length) * 10) / 10
        costs = []
      }
      return { c: b64(grid.chroma), l: b64(grid.luma), t: b64(grid.lit) }
    }
    var tick = async function () {
      if (stopped) return
      var found = video()
      var now = Date.now()
      var r = null
      try {
        if (!found) armed = false
        else if (found.bad) {
          if (now - lastHello >= HELLO) {
            lastHello = now
            r = await post({ kind: 'tainted', area: found.area })
          }
        } else if (armed && visible() && found.v.currentTime !== lastTime) {
          lastTime = found.v.currentTime
          lastHello = now
          tainted = false
          var grid = ad() ? null : sample(found.v)
          r = await post(grid ? { kind: 'frame', area: found.area, grid: grid } : { kind: tainted ? 'tainted' : 'hello', area: found.area })
        } else if (now - lastHello >= (armed ? 2000 : HELLO)) {
          lastHello = now
          r = await post({ kind: 'hello', area: found.area })
        }
      } catch (e) {
        r = null
      }
      if (r) {
        armed = !!r.armed
        every = Math.max(250, Math.min(5000, Number(r.every) || 500))
      }
      if (!stopped) setTimeout(tick, armed ? every : 1000)
    }
    setTimeout(tick, 1000)
  })()
}
