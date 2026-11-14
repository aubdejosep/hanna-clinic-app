// Applies the person's theme, text size and fonts before the app draws, so the page never flashes the
// wrong colours. The app saves them here after login (src/lib/theme.js); the server keeps the real copy.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('hpw.display') || '{}')
    if (t.theme && t.theme !== 'brand') document.documentElement.dataset.theme = t.theme
    if (t.textSize && t.textSize !== 'standard') document.documentElement.dataset.text = t.textSize
    var f = t.fonts || {}
    ;['head', 'menu', 'text', 'button'].forEach(function (k) {
      if (f[k] === 'montserrat' || f[k] === 'system') document.documentElement.dataset['font' + k[0].toUpperCase() + k.slice(1)] = f[k]
    })
    if (f.menuWeight === 'regular' || f.menuWeight === 'semibold') document.documentElement.dataset.menuWeight = f.menuWeight
  } catch (e) { /* private window: brand colours, standard text */ }
})()
