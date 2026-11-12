// Applies the person's theme and text size before the app draws, so the page never flashes the
// wrong colours. The app saves them here after login (src/lib/theme.js); the server keeps the real copy.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('hpw.display') || '{}')
    if (t.theme && t.theme !== 'brand') document.documentElement.dataset.theme = t.theme
    if (t.textSize && t.textSize !== 'standard') document.documentElement.dataset.text = t.textSize
  } catch (e) { /* private window: brand colours, standard text */ }
})()
