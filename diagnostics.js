/* Local capability probe. No user-agent capture, network, storage or annotation. */
'use strict';
(() => {
  let failedResource = false;
  let probeUrl = null;
  const status = document.getElementById('diagnostic-status');
  const button = document.getElementById('diagnostic-download');
  function update() {
    const state = document.documentElement.dataset.reviewerState || 'pending';
    const protocol = location.protocol === 'https:' ? 'HTTPS' : location.protocol === 'http:' ? 'HTTP (nur lokaler Test)' : 'Dateiviewer';
    status.textContent = 'JavaScript-Diagnose läuft · ' + protocol + ' · Formular: ' + state +
      (failedResource ? ' · Ressource wurde blockiert oder nicht geladen.' : '') +
      ' · Dies bestätigt keinen echten iPad-/Safari-Test.';
    if (failedResource && state !== 'ready') {
      document.getElementById('load-state').textContent = 'Formular nicht verfügbar: benötigte Ressource fehlt oder wurde blockiert (z. B. CSP/SRI). In Safari über HTTPS öffnen und Koordinator informieren. Keine Antwort erzeugt.';
    }
  }
  window.addEventListener('reviewer-state', update);
  window.addEventListener('error', event => {
    if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK')) {
      failedResource = true; update();
    }
  }, true);
  button.disabled = !(typeof Blob === 'function' && typeof URL.createObjectURL === 'function');
  button.addEventListener('click', () => {
    if (probeUrl) URL.revokeObjectURL(probeUrl);
    probeUrl = URL.createObjectURL(new Blob(['Lokale Downloadprobe. Keine Review-Antwort.\n'],{type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = probeUrl; link.download = 'lokaler-browser-test.txt';
    document.body.appendChild(link); link.click(); link.remove();
    document.getElementById('diagnostic-result').textContent = 'Lokaler Testdownload wurde angefordert. Ob die Datei angekommen ist, bitte auf dem Gerät prüfen. Es wurde nichts übertragen.';
  });
  update();
})();
