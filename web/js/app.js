/* Arranque: navegación entre secciones, tema, botón atrás y sincronización inicial. */
(function() {
    var $ = function(id) { return document.getElementById(id); };
    var SECTION_KEY = 'misnotas-section';

    Icons.hydrate(document);

    // ---------- Secciones ----------
    function showSection(name) {
        if (SECTIONS.indexOf(name) === -1) name = 'validaciones';
        SECTIONS.forEach(function(s) { $('section-' + s).classList.toggle('hidden', s !== name); });
        document.body.classList.toggle('agenda-active', name === 'agenda');
        document.querySelectorAll('.nav-item[data-section]').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-section') === name);
        });
        updateThemeColor();
        Data.ls(SECTION_KEY, name);
        if (name === 'agenda') Agenda.refresh();
        if (name === 'seguimiento') mountSeguimiento();
    }
    var SECTIONS = ['validaciones', 'seguimiento', 'agenda'];
    function currentSection() {
        for (var i = 0; i < SECTIONS.length; i++) if (!$('section-' + SECTIONS[i]).classList.contains('hidden')) return SECTIONS[i];
        return 'validaciones';
    }
    // El tablero de seguimiento es un módulo aparte: se carga la primera vez que se abre.
    var seguimientoCarga = null;
    function mountSeguimiento() {
        if (seguimientoCarga) return seguimientoCarga;
        seguimientoCarga = import(new URL('seguimiento/app.js', document.baseURI).href)
            .then(function(m) { return m.montar(); })
            .catch(function(e) {
                console.error(e);
                seguimientoCarga = null;
                $('sincronizacion').textContent = 'No se pudo abrir el tablero.';
                var box = document.querySelector('#section-seguimiento .sg-scroll');
                if (box && !box.querySelector('.sg-error')) box.insertAdjacentHTML('afterbegin', '<p class="sg-error">' +
                    (location.protocol === 'file:' ? 'El tablero de seguimiento necesita abrirse desde un servidor (Vercel, la app Android o <code>npx serve web</code>), no con doble clic.' : 'Revisa tu conexión a internet e inténtalo de nuevo.') + '</p>');
            });
        return seguimientoCarga;
    }
    function updateThemeColor() {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        var dark = document.body.classList.contains('sap-dark');
        var pink = document.body.classList.contains('sap-pink');
        meta.setAttribute('content', currentSection() === 'agenda' ? (dark ? '#8E3558' : '#FF8FB1') : (dark ? '#1A1C20' : pink ? '#FFF7FA' : '#FFFFFF'));
    }
    document.querySelectorAll('.nav-item[data-section]').forEach(function(b) {
        b.addEventListener('click', function() { showSection(b.getAttribute('data-section')); });
    });

    // ---------- Tema: claro, oscuro o automático (según el sistema) ----------
    var THEMES = [
        { id: 'light', icon: 'sun', label: 'Claro' },
        { id: 'dark', icon: 'moon', label: 'Oscuro' },
        { id: 'pink', icon: 'bow', label: 'Rosa' },
        { id: 'auto', icon: 'contrast', label: 'Auto' }
    ];
    var themeId = Data.ls('sap-theme');
    if (!THEMES.some(function(t) { return t.id === themeId; })) themeId = 'auto';
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function applyTheme() {
        var t = THEMES.find(function(x) { return x.id === themeId; });
        var dark = themeId === 'dark' || (themeId === 'auto' && mq && mq.matches);
        document.body.classList.toggle('sap-dark', !!dark);
        document.body.classList.toggle('sap-pink', themeId === 'pink');
        document.querySelectorAll('.js-theme-icon').forEach(function(el) { el.innerHTML = Icons.svg(t.icon); });
        document.querySelectorAll('.js-theme-label').forEach(function(el) { el.textContent = t.label; });
        document.querySelectorAll('.js-theme-toggle').forEach(function(el) { el.title = 'Tema: ' + t.label; });
        if (window.AndroidBridge && window.AndroidBridge.setDarkBars) window.AndroidBridge.setDarkBars(!!dark);
        updateThemeColor();
    }
    applyTheme();
    if (mq && mq.addEventListener) mq.addEventListener('change', function() { if (themeId === 'auto') applyTheme(); });
    document.querySelectorAll('.js-theme-toggle').forEach(function(b) {
        b.addEventListener('click', async function(e) {
            var v = await UI.menu(e.currentTarget, THEMES.map(function(t) {
                return { label: t.id === 'auto' ? 'Automático (según el sistema)' : t.label, icon: t.id === themeId ? 'check' : t.icon, value: t.id, primary: t.id === themeId };
            }), 'Tema');
            if (!v) return;
            themeId = v;
            Data.ls('sap-theme', themeId);
            applyTheme();
        });
    });

    // ---------- Botón atrás (Android) y Escape (PC) ----------
    // Devuelve true si la app lo manejó; si es false, Android minimiza la app.
    window.onAndroidBack = function() {
        if (UI.closeTop()) return true;
        if (Validaciones.handleBack()) return true;
        if (window.Seguimiento && currentSection() === 'seguimiento' && window.Seguimiento.handleBack()) return true;
        if (currentSection() !== 'validaciones') { showSection('validaciones'); return true; }
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
