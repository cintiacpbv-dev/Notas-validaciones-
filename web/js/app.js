/* Arranque: navegación entre secciones, tema, botón atrás y sincronización inicial. */
(function() {
    var $ = function(id) { return document.getElementById(id); };
    var SECTION_KEY = 'misnotas-section';

    Icons.hydrate(document);

    // ---------- Secciones ----------
    function showSection(name) {
        if (name !== 'agenda' && name !== 'validaciones') name = 'validaciones';
        $('section-validaciones').classList.toggle('hidden', name !== 'validaciones');
        $('section-agenda').classList.toggle('hidden', name !== 'agenda');
        document.body.classList.toggle('agenda-active', name === 'agenda');
        document.querySelectorAll('.nav-item[data-section]').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-section') === name);
        });
        updateThemeColor();
        Data.ls(SECTION_KEY, name);
        if (name === 'agenda') Agenda.refresh();
    }
    function currentSection() { return $('section-agenda').classList.contains('hidden') ? 'validaciones' : 'agenda'; }
    function updateThemeColor() {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        var dark = document.body.classList.contains('sap-dark');
        meta.setAttribute('content', currentSection() === 'agenda' ? (dark ? '#8E3558' : '#FF8FB1') : (dark ? '#1A1C20' : '#FFFFFF'));
    }
    document.querySelectorAll('.nav-item[data-section]').forEach(function(b) {
        b.addEventListener('click', function() { showSection(b.getAttribute('data-section')); });
    });

    // ---------- Tema: claro, oscuro o automático (según el sistema) ----------
    var THEMES = [
        { id: 'light', icon: 'sun', label: 'Claro' },
        { id: 'dark', icon: 'moon', label: 'Oscuro' },
        { id: 'auto', icon: 'contrast', label: 'Auto' }
    ];
    var themeId = Data.ls('sap-theme');
    if (!THEMES.some(function(t) { return t.id === themeId; })) themeId = 'auto';
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function applyTheme() {
        var t = THEMES.find(function(x) { return x.id === themeId; });
        var dark = themeId === 'dark' || (themeId === 'auto' && mq && mq.matches);
        document.body.classList.toggle('sap-dark', !!dark);
        document.querySelectorAll('.js-theme-icon').forEach(function(el) { el.innerHTML = Icons.svg(t.icon); });
        document.querySelectorAll('.js-theme-label').forEach(function(el) { el.textContent = t.label; });
        document.querySelectorAll('.js-theme-toggle').forEach(function(el) { el.title = 'Tema ' + t.label.toLowerCase() + ' (toca para cambiar)'; });
        if (window.AndroidBridge && window.AndroidBridge.setDarkBars) window.AndroidBridge.setDarkBars(!!dark);
        updateThemeColor();
    }
    applyTheme();
    if (mq && mq.addEventListener) mq.addEventListener('change', function() { if (themeId === 'auto') applyTheme(); });
    document.querySelectorAll('.js-theme-toggle').forEach(function(b) {
        b.addEventListener('click', function() {
            var i = THEMES.findIndex(function(t) { return t.id === themeId; });
            themeId = THEMES[(i + 1) % THEMES.length].id;
            Data.ls('sap-theme', themeId);
            applyTheme();
            UI.toast('Tema ' + THEMES.find(function(t) { return t.id === themeId; }).label.toLowerCase(), 'info');
        });
    });

    // ---------- Botón atrás (Android) y Escape (PC) ----------
    // Devuelve true si la app lo manejó; si es false, Android minimiza la app.
    window.onAndroidBack = function() {
        if (UI.closeTop()) return true;
        if (Validaciones.handleBack()) return true;
        if (currentSection() === 'agenda') { showSection('validaciones'); return true; }
        return false;
    };
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') UI.closeTop() || Validaciones.handleBack();
    });

    // ---------- Arranque ----------
    Promise.all([Validaciones.init(), Agenda.init()]).then(function() {
        showSection(Data.ls(SECTION_KEY) || 'validaciones');
        Sync.syncNow();
    });

    // Service worker solo en navegador (PWA para PC); la app Android ya trae todo sin conexión.
    if ('serviceWorker' in navigator && !window.AndroidBridge && /^https?:$/.test(location.protocol)) {
        window.addEventListener('load', function() { navigator.serviceWorker.register('sw.js').catch(function() {}); });
    }
})();
