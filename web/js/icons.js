/* Set de iconos propio de Mis Notas (retícula 24×24, trazo 1.6).
   Se inyecta como sprite <symbol> y se usa con Icons.svg('nombre'). */
var Icons = (function() {
    var P = {
        cursor: '<path d="M6.2 3.8 18 10.9l-5.2 1.5 3.1 5.4-2.2 1.3-3.1-5.4-3.9 3.9z"/>',
        note: '<path d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v9a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z"/><path d="M7.8 9h8.4M7.8 12.2h5"/>',
        strike: '<path d="M4 17.5 7.6 7.5h.8l3.6 10M5.3 14h5.4"/><path d="M2.8 11.6h10.4" stroke-width="1.9"/><path d="M15.3 18.5 18 13l2.7 5.5"/>',
        camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.8" r="3.4"/>',
        video: '<rect x="3.5" y="6" width="12" height="12" rx="1.6"/><path d="m15.5 10.4 5-2.9v9l-5-2.9"/>',
        mic: '<rect x="9.2" y="3.5" width="5.6" height="11" rx="2.8"/><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5M9 20.5h6"/>',
        stopwatch: '<circle cx="12" cy="13.5" r="6.5"/><path d="M12 13.5V10M10 3.5h4M12 3.5V7M17.8 7.7l1.4-1.4"/>',
        chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
        chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
        chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
        arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
        zoomIn: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M10.5 8v5M8 10.5h5"/>',
        zoomOut: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M8 10.5h5"/>',
        fitWidth: '<path d="M4 5v14M20 5v14M7.5 12h9M10 9.5 7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"/>',
        share: '<path d="M12 14.5v-11M8 7.5l4-4 4 4"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16"/>',
        whatsapp: '<path d="m4.4 19.6 1.2-4A8 8 0 1 1 8.5 18.5z"/><path d="M9.2 8.7c.3-.5.8-.6 1.1-.3l.9 1.5c.2.3.1.6-.1.9l-.5.5c.5 1.1 1.4 2 2.5 2.5l.5-.5c.3-.2.6-.3.9-.1l1.5.9c.4.2.4.8-.1 1.1-.6.5-1.3.7-2.1.5-2.3-.6-4.1-2.4-4.7-4.7-.2-.8 0-1.6.1-2.3z" fill="currentColor" stroke="none"/>',
        cloud: '<path d="M7.5 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1a4.7 4.7 0 0 0 .9 9.4z"/>',
        cloudCheck: '<path d="M7.5 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1a4.7 4.7 0 0 0 .9 9.4z"/><path d="m9.4 13.9 2 2 3.6-3.7"/>',
        cloudOff: '<path d="M7.5 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1a4.7 4.7 0 0 0 .9 9.4z"/><path d="m4 4 16 16"/>',
        cloudAlert: '<path d="M7.5 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1a4.7 4.7 0 0 0 .9 9.4z"/><path d="M12 10.5v3M12 16h.01"/>',
        sync: '<path d="M18.8 9A7.5 7.5 0 0 0 5.6 8.3M5.2 15a7.5 7.5 0 0 0 13.2.7"/><path d="M19 4.5V9h-4.5M5 19.5V15h4.5"/>',
        phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
        more: '<path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="2.8"/>',
        trash: '<path d="M5 7h14M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M7 7l.8 11.3A1.8 1.8 0 0 0 9.6 20h4.8a1.8 1.8 0 0 0 1.8-1.7L17 7M10.5 11v5M13.5 11v5"/>',
        edit: '<path d="m15.5 5.5 3 3L9 18H6v-3zM13.5 7.5l3 3"/>',
        check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
        checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.4 2.5 2.5 5-5.2"/>',
        circle: '<circle cx="12" cy="12" r="8.5"/>',
        list: '<path d="M9 7h11M9 12h11M9 17h7M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
        panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
        file: '<path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13.5 3.5v5h5M8.5 13h7M8.5 16h4.5"/>',
        filePlus: '<path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13.5 3.5v5h5M12 11.5v6M9 14.5h6"/>',
        upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
        download: '<path d="M12 4v11.5M7.5 11l4.5 4.5 4.5-4.5M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
        close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
        sliders: '<path d="M4.5 7H13M17 7h2.5M4.5 17H7M11 17h8.5"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
        braces: '<path d="M8.5 4.5C6.8 4.5 6 5.3 6 6.8v2.4c0 1.3-.7 2.3-2 2.8 1.3.5 2 1.5 2 2.8v2.4c0 1.5.8 2.3 2.5 2.3M15.5 4.5c1.7 0 2.5.8 2.5 2.3v2.4c0 1.3.7 2.3 2 2.8-1.3.5-2 1.5-2 2.8v2.4c0 1.5-.8 2.3-2.5 2.3"/>',
        images: '<rect x="3.5" y="7" width="13.5" height="12" rx="1.5"/><path d="M7 4h11.5A2 2 0 0 1 20.5 6v10"/><path d="m3.5 16 3.6-3.6 3 3 1.9-1.9 5 4.5"/><circle cx="12.6" cy="10.6" r="1.2"/>',
        play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
        stop: '<rect x="7" y="7" width="10" height="10" rx="1.6" fill="currentColor"/>',
        record: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
        sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
        moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
        contrast: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
        clipboard: '<path d="M9 4h6v2.8H9z"/><path d="M15 5.4h2.5A1.5 1.5 0 0 1 19 6.9v12.6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5V6.9a1.5 1.5 0 0 1 1.5-1.5H9"/><path d="m8.8 13.7 2.2 2.2 4.2-4.4"/>',
        bow: '<path d="M12 11.6C9.4 8 4.6 6.4 3.8 9.2c-.7 2.4.2 5.4 1.8 5.7 2.3.4 4.6-1.3 6.4-3.3zM12 11.6c2.6-3.6 7.4-5.2 8.2-2.4.7 2.4-.2 5.4-1.8 5.7-2.3.4-4.6-1.3-6.4-3.3z"/><circle cx="12" cy="11.8" r="1.7"/><path d="m10.9 13.4-1.8 5.6M13.1 13.4l1.8 5.6"/>',
        sort: '<path d="M4 7h16M7 12h10M10 17h4"/>',
        external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
        user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8"/>',
        logout: '<path d="M10 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h4M15 16l4-4-4-4M19 12H9.5"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        alert: '<path d="M10.7 4.8 3.4 17.5A1.5 1.5 0 0 0 4.7 19.7h14.6a1.5 1.5 0 0 0 1.3-2.2L13.3 4.8a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 10v4M12 16.8h.01"/>',
        info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
        pages: '<path d="M8.5 3.5h7.8L20 7.2V17"/><rect x="4" y="6.5" width="12" height="14" rx="1.5"/><path d="M7 11h6M7 14h6M7 17h3.5"/>',
        marker: '<path d="M12 3.5a6.5 6.5 0 0 1 6.5 6.5c0 4.6-6.5 10.5-6.5 10.5S5.5 14.6 5.5 10A6.5 6.5 0 0 1 12 3.5z"/><circle cx="12" cy="10" r="2.2"/>',
        grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="2.6"/>',
        layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
        tracker: '<path d="M4.5 19.5h15M7 16v-5M11 16V7M15 16v-3M19 16V9"/>',
        expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        key: '<circle cx="8" cy="15" r="3.8"/><path d="m10.7 12.3 8.3-8.3M16.5 6.5l2.5 2.5M14.5 8.5l1.8 1.8"/>'
    };

    function inject() {
        if (document.getElementById('mn-icon-sprite')) return;
        var s = '<svg xmlns="http://www.w3.org/2000/svg" id="mn-icon-sprite" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">';
        Object.keys(P).forEach(function(k) {
            s += '<symbol id="i-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + P[k] + '</symbol>';
        });
        s += '</svg>';
        document.body.insertAdjacentHTML('afterbegin', s);
    }

    function svg(name, cls) {
        return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
    }

    // Reemplaza los <i data-icon="nombre"></i> del HTML estático
    function hydrate(root) {
        (root || document).querySelectorAll('i[data-icon]').forEach(function(el) {
            el.outerHTML = svg(el.getAttribute('data-icon'), el.getAttribute('data-class'));
        });
    }

    return { inject: inject, svg: svg, hydrate: hydrate, names: Object.keys(P) };
})();
Icons.inject();
