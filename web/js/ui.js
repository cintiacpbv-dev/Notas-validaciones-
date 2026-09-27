/* Componentes de interfaz compartidos: diálogos, menús, avisos y guardado de archivos.
   En celular los diálogos y menús aparecen como hoja inferior; en tablet/PC, centrados
   o anclados al botón que los abrió. */
var UI = (function() {
    var stack = [];
    var ic = function(n) { return window.Icons ? Icons.svg(n) : ''; };

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(message, type) {
        var old = document.querySelectorAll('.toast');
        if (old.length > 2) old[0].remove();
        var t = document.createElement('div');
        t.className = 'toast' + (type ? ' toast-' + type : '');
        t.setAttribute('role', 'status');
        t.innerHTML = (type === 'error' ? ic('alert') : type === 'info' ? ic('info') : ic('check')) + '<span>' + escapeHtml(message) + '</span>';
        document.body.appendChild(t);
        setTimeout(function() { if (t.parentNode) t.remove(); }, 3200);
    }

    function isPhone() { return window.matchMedia('(max-width: 599px)').matches; }

    // Abre un diálogo genérico. build(dialogEl, close) arma el contenido.
    function open(build, onCancel, extraClass) {
        var ov = document.createElement('div');
        ov.className = 'ui-overlay';
        var dlg = document.createElement('div');
        dlg.className = 'ui-dialog' + (extraClass ? ' ' + extraClass : '');
        dlg.setAttribute('role', 'dialog');
        dlg.setAttribute('aria-modal', 'true');
        ov.appendChild(dlg);
        var entry = { el: ov, cancel: null };
        function close() {
            var i = stack.indexOf(entry);
            if (i !== -1) stack.splice(i, 1);
            ov.classList.add('is-closing');
            setTimeout(function() { ov.remove(); }, 140);
        }
        entry.cancel = function() { close(); if (onCancel) onCancel(); };
        // Solo se cierra si el toque empezó y terminó fuera del diálogo (evita cierres al seleccionar texto)
        ov.addEventListener('mousedown', function(e) { ov._down = e.target === ov; });
        ov.addEventListener('click', function(e) { if (e.target === ov && ov._down !== false) entry.cancel(); });
        build(dlg, close);
        stack.push(entry);
        document.body.appendChild(ov);
        if (!isPhone()) {
            var focusable = dlg.querySelector('[data-autofocus], input:not([type=checkbox]), textarea');
            if (focusable) setTimeout(function() { focusable.focus(); if (focusable.tagName === 'INPUT' && focusable.select && focusable.value) focusable.select(); }, 50);
        }
        return entry;
    }

    function alert(message, title) {
        return new Promise(function(resolve) {
            open(function(dlg, close) {
                dlg.innerHTML = (title ? '<h3>' + escapeHtml(title) + '</h3>' : '') + '<p>' + escapeHtml(message) + '</p>' +
                    '<div class="ui-actions"><button class="btn" data-ok>Entendido</button></div>';
                dlg.querySelector('[data-ok]').addEventListener('click', function() { close(); resolve(); });
            }, resolve);
        });
    }

    function confirm(message, opts) {
        opts = opts || {};
        return new Promise(function(resolve) {
            open(function(dlg, close) {
                dlg.innerHTML = '<h3>' + escapeHtml(opts.title || '¿Continuar?') + '</h3><p>' + escapeHtml(message) + '</p>' +
                    '<div class="ui-actions"><button class="btn btn-ghost" data-no>' + escapeHtml(opts.cancelText || 'Cancelar') + '</button>' +
                    '<button class="btn' + (opts.danger ? ' btn-danger' : '') + '" data-ok>' + escapeHtml(opts.okText || 'Aceptar') + '</button></div>';
                dlg.querySelector('[data-ok]').addEventListener('click', function() { close(); resolve(true); });
                dlg.querySelector('[data-no]').addEventListener('click', function() { close(); resolve(false); });
            }, function() { resolve(false); });
        });
    }

    function prompt(message, defaultValue, opts) {
        opts = opts || {};
        return new Promise(function(resolve) {
            open(function(dlg, close) {
                dlg.innerHTML = '<h3>' + escapeHtml(message) + '</h3>' +
                    (opts.help ? '<p>' + escapeHtml(opts.help) + '</p>' : '') +
                    '<input type="text" class="ui-input" value="' + escapeHtml(defaultValue || '') + '" placeholder="' + escapeHtml(opts.placeholder || '') + '" enterkeyhint="done">' +
                    '<div class="ui-actions"><button class="btn btn-ghost" data-no>Cancelar</button><button class="btn" data-ok>' + escapeHtml(opts.okText || 'Aceptar') + '</button></div>';
                var input = dlg.querySelector('input');
                function ok() { close(); resolve(input.value); }
                dlg.querySelector('[data-ok]').addEventListener('click', ok);
                dlg.querySelector('[data-no]').addEventListener('click', function() { close(); resolve(null); });
                input.addEventListener('keydown', function(e) { if (e.key === 'Enter') ok(); });
            }, function() { resolve(null); });
        });
    }

    function itemHtml(o, i) {
        if (o.separator) return '<div class="ui-menu-sep" role="separator"></div>';
        if (o.heading) return '<div class="ui-menu-heading">' + escapeHtml(o.heading) + '</div>';
        return '<button class="ui-menu-item' + (o.danger ? ' is-danger' : '') + (o.primary ? ' is-primary' : '') + '" data-i="' + i + '"' + (o.disabled ? ' disabled' : '') + ' role="menuitem">' +
            (o.icon ? '<span class="ui-menu-ic">' + ic(o.icon) + '</span>' : '') +
            '<span class="ui-menu-text"><span>' + escapeHtml(o.label) + '</span>' + (o.hint ? '<small>' + escapeHtml(o.hint) + '</small>' : '') + '</span></button>';
    }

    // Lista de opciones (hoja de acciones). options: [{label, value, icon, hint, danger, primary}]
    function choice(title, options, message) {
        return new Promise(function(resolve) {
            open(function(dlg, close) {
                dlg.innerHTML = '<div class="ui-head"><h3>' + escapeHtml(title) + '</h3><button class="ui-x" data-no aria-label="Cerrar">' + ic('close') + '</button></div>' +
                    (message ? '<p>' + escapeHtml(message) + '</p>' : '') +
                    '<div class="ui-menu-list" role="menu">' + options.map(itemHtml).join('') + '</div>';
                dlg.querySelectorAll('[data-i]').forEach(function(b) {
                    b.addEventListener('click', function() { close(); resolve(options[+b.getAttribute('data-i')].value); });
                });
                dlg.querySelector('[data-no]').addEventListener('click', function() { close(); resolve(null); });
            }, function() { resolve(null); }, 'ui-dialog-menu');
        });
    }

    // Menú contextual anclado a un botón (en celular se muestra como hoja inferior).
    function menu(anchor, items, title) {
        if (isPhone() || !anchor) return choice(title || 'Opciones', items);
        return new Promise(function(resolve) {
            var ov = document.createElement('div');
            ov.className = 'ui-popover-layer';
            var pop = document.createElement('div');
            pop.className = 'ui-popover';
            pop.setAttribute('role', 'menu');
            pop.innerHTML = items.map(itemHtml).join('');
            ov.appendChild(pop);
            document.body.appendChild(ov);
            var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
            var left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8);
            var top = r.bottom + 6;
            if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
            pop.style.left = left + 'px'; pop.style.top = top + 'px';
            var entry = { el: ov, cancel: function() { done(null); } };
            stack.push(entry);
            function done(v) {
                var i = stack.indexOf(entry); if (i !== -1) stack.splice(i, 1);
                ov.remove(); resolve(v);
            }
            ov.addEventListener('mousedown', function(e) { if (e.target === ov) done(null); });
            ov.addEventListener('touchstart', function(e) { if (e.target === ov) done(null); }, { passive: true });
            pop.querySelectorAll('[data-i]').forEach(function(b) {
                b.addEventListener('click', function() { done(items[+b.getAttribute('data-i')].value); });
            });
            var first = pop.querySelector('[data-i]:not([disabled])'); if (first) first.focus();
            pop.addEventListener('keydown', function(e) {
                var btns = Array.prototype.slice.call(pop.querySelectorAll('[data-i]:not([disabled])')), k = btns.indexOf(document.activeElement);
                if (e.key === 'ArrowDown') { e.preventDefault(); (btns[k + 1] || btns[0]).focus(); }
                if (e.key === 'ArrowUp') { e.preventDefault(); (btns[k - 1] || btns[btns.length - 1]).focus(); }
            });
        });
    }

    // Cierra el diálogo superior (botón "atrás" de Android / tecla Escape).
    function closeTop() {
        if (!stack.length) return false;
        stack[stack.length - 1].cancel();
        return true;
    }

    // Registra un panel propio para que el botón atrás lo cierre. Devuelve una función para quitarlo.
    function pushLayer(cancelFn) {
        var entry = { el: null, cancel: cancelFn };
        stack.push(entry);
        return function() { var i = stack.indexOf(entry); if (i !== -1) stack.splice(i, 1); };
    }

    function blobToBase64(blob) {
        return new Promise(function(resolve, reject) {
            var r = new FileReader();
            r.onload = function() { var s = String(r.result); resolve(s.substring(s.indexOf(',') + 1)); };
            r.onerror = reject;
            r.readAsDataURL(blob);
        });
    }

    function downloadBlob(blob, fileName) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = fileName; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(function() { a.remove(); URL.revokeObjectURL(url); }, 1500);
    }

    // Guarda y ofrece compartir un archivo (respaldo .zip). En Android usa el puente nativo.
    async function saveFile(blob, fileName, mime) {
        mime = mime || blob.type || 'application/octet-stream';
        if (window.AndroidBridge && window.AndroidBridge.beginFile) {
            var CHUNK = 3 * 256 * 1024; // múltiplo de 3 para concatenar base64
            var id = window.AndroidBridge.beginFile(fileName, mime);
            for (var off = 0; off < blob.size; off += CHUNK) {
                window.AndroidBridge.appendChunk(id, await blobToBase64(blob.slice(off, off + CHUNK)));
            }
            var where = window.AndroidBridge.finishFile(id);
            toast(where ? 'Guardado en ' + where : 'Archivo listo');
            return;
        }
        downloadBlob(blob, fileName);
        toast('Archivo descargado');
    }

    function newId(prefix) {
        return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    return {
        escapeHtml: escapeHtml, toast: toast, open: open, alert: alert, confirm: confirm, prompt: prompt,
        choice: choice, menu: menu, closeTop: closeTop, pushLayer: pushLayer, saveFile: saveFile, newId: newId,
        blobToBase64: blobToBase64, downloadBlob: downloadBlob, isPhone: isPhone
    };
})();
