// auth.js – Login-Screen und Session-Verwaltung.
// Kein import/export – schreibt auf window.AR.auth.

(function () {
  'use strict';

  var JWT_KEY  = 'ar_jwt';
  var ROLE_KEY = 'ar_role';

  function isLoggedIn() { return !!sessionStorage.getItem(JWT_KEY); }
  function getRole()    { return sessionStorage.getItem(ROLE_KEY); }

  function saveSession(jwt, role) {
    sessionStorage.setItem(JWT_KEY,  jwt);
    sessionStorage.setItem(ROLE_KEY, role);
  }

  function clearSession() {
    sessionStorage.removeItem(JWT_KEY);
    sessionStorage.removeItem(ROLE_KEY);
  }

  // Initialisiert den Login-Screen und ruft onSuccess(role) nach erfolgreichem Login auf.
  function initLoginScreen(onSuccess) {
    var screen    = document.getElementById('login-screen');
    var tabs      = document.querySelectorAll('.login-tab');
    var tabQr     = document.getElementById('login-tab-qr');
    var tabPin    = document.getElementById('login-tab-pin');
    var errorMsg  = document.getElementById('login-error');
    var pinBtn    = document.getElementById('login-pin-btn');
    var loginVideo = document.getElementById('login-video');
    var loginCanvas = document.getElementById('login-canvas');

    screen.classList.remove('hidden');

    function hideError() { errorMsg.classList.add('hidden'); }
    function showError(msg) {
      errorMsg.textContent = msg || 'Anmeldung fehlgeschlagen.';
      errorMsg.classList.remove('hidden');
    }

    function handleSuccess(jwt, role) {
      saveSession(jwt, role);
      window.AR.qr.stopQrScanner();
      screen.classList.add('hidden');
      hideError();
      onSuccess(role);
    }

    // Tab-Umschalter
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('login-tab--active'); });
        tab.classList.add('login-tab--active');

        if (tab.dataset.tab === 'qr') {
          tabPin.classList.add('hidden');
          tabQr.classList.remove('hidden');
          window.AR.qr.startQrScanner(loginVideo, loginCanvas, handleQrResult);
        } else {
          tabQr.classList.add('hidden');
          tabPin.classList.remove('hidden');
          window.AR.qr.stopQrScanner();
        }
      });
    });

    // QR-Login
    function handleQrResult(qrValue) {
      if (!qrValue.startsWith('login:')) return;
      hideError();
      window.AR.api.loginWithToken(qrValue)
        .then(function (res) { handleSuccess(res.jwt, res.role); })
        .catch(function ()   { showError('Ungültiger QR-Code oder Token abgelaufen.'); });
    }

    // QR-Scanner direkt starten (erster Tab)
    window.AR.qr.startQrScanner(loginVideo, loginCanvas, handleQrResult);

    // PIN-Login
    pinBtn.addEventListener('click', function () {
      hideError();
      var username = document.getElementById('login-username').value.trim();
      var pin      = document.getElementById('login-pin').value.trim();
      if (!username || pin.length !== 4) {
        showError('Bitte Benutzername und 4-stellige PIN eingeben.');
        return;
      }
      window.AR.api.loginWithPin(username, pin)
        .then(function (res) { handleSuccess(res.jwt, res.role); })
        .catch(function ()   { showError('Benutzername oder PIN falsch.'); });
    });

    document.getElementById('login-pin').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') pinBtn.click();
    });
  }

  window.AR = window.AR || {};
  window.AR.auth = { isLoggedIn: isLoggedIn, getRole: getRole, clearSession: clearSession, initLoginScreen: initLoginScreen };
})();