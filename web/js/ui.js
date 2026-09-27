/* Utilidades de interfaz compartidas: diálogos, avisos y guardado de archivos.
   Los diálogos reemplazan alert/confirm/prompt para que se vean bien en
   celular (hoja inferior), tablet y PC (ventana centrada). */
var UI = (function() {
    var stack = [];

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(message, type) {
        var t = document.createElement('div');
        t.className = 'toast' + (type ? ' toast-' + type : '');
        t.textContent = message;
        document.body.appendChild(t);
        setTimeout(function() { if (t.parentNode) t.remove(); }, 3000);
    }

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
            ov.remove();
        }
        entry.cancel = function() { close(); if (onCancel) onCancel(); };
        ov.addEventListener('click', function(e) { if (e.target === ov) entry.cancel(); });
        build(dlg, close);
        stack.push(entry);
        document.body.appendChild(ov);
        var focusable = dlg.querySelector('input, textarea, [data-autofocus]');
        if (focusable) setTimeout(function() { focusable.focus(); if (focusable.select) focusable.select(); }, 60);
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
                dlg.innerHTML = '<h3>' + escapeHtml(opts.title || '¿Estás segura?') + '</h3><p>' + escapeHtml(message) + '</p>' +
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
                    '<input type="text" value="' + escapeHtml(defaultValue || '') + '" placeholder="' + escapeHtml(opts.placeholder || '') + '" enterkeyhint="done">' +
                    '<div class="ui-actions"><button class="btn btn-ghost" data-no>Cancelar</button><button class="btn" data-ok>' + escapeHtml(opts.okText || 'Aceptar') + '</button></div>';
                var input = dlg.querySelector('input');
                function ok() { close(); resolve(input.value); }
                dlg.querySelector('[data-ok]').addEventListener('click', ok);
                dlg.querySelector('[data-no]').addEventListener('click', function() { close(); resolve(null); });
                input.addEventListener('keydown', function(e) { if (e.key === 'Enter') ok(); });
            }, function() { resolve(null); });
        });
    }

    // Lista de opciones (hoja de acciones). options: [{label, value, danger}]
    function choice(title, options, message) {
        return new Promise(function(resolve) {
            open(function(dlg, close) {
                var html = '<h3>' + escapeHtml(title) + '</h3>' + (message ? '<p>' + escapeHtml(message) + '</p>' : '') + '<div class="ui-choices">';
                options.forEach(function(o, i) {
                    html += '<button class="btn ' + (o.danger ? 'btn-danger' : (o.primary ? '' : 'btn-ghost')) + '" data-i="' + i + '">' + escapeHtml(o.label) + '</button>';
                });
                html += '<button class="btn btn-ghost" data-no style="justify-content:center">Cancelar</button></div>';
                dlg.innerHTML = html;
                dlg.querySelectorAll('[data-i]').forEach(function(b) {
                    b.addEventListener('click', function() { close(); resolve(options[+b.getAttribute('data-i')].value); });
                });
                dlg.querySelector('[data-no]').addEventListener('click', function() { close(); resolve(null); });
            }, function() { resolve(null); });
        });
    }

    // Cierra el diálogo superior (botón "atrás" de Android / tecla Escape).
    function closeTop() {
        if (!stack.length) return false;
        stack[stack.length - 1].cancel();
        return true;
    }

    // Registra un panel propio (por ejemplo el editor de notas) para que
    // el botón atrás lo cierre. Devuelve una función para quitarlo.
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

    // Guarda/comparte un archivo. En la app Android usa el puente nativo
    // (guarda en Descargas y abre "Compartir"); en navegador usa Web Share o descarga.
    async function saveFile(blob, fileName, mime) {
        mime = mime || blob.type || 'application/octet-stream';
        if (window.AndroidBridge && window.AndroidBridge.beginFile) {
            var CHUNK = 3 * 256 * 1024; // múltiplo de 3 para que el base64 se pueda concatenar
            var id = window.AndroidBridge.beginFile(fileName, mime);
            for (var off = 0; off < blob.size; off += CHUNK) {
                var part = await blobToBase64(blob.slice(off, off + CHUNK));
                window.AndroidBridge.appendChunk(id, part);
            }
            var where = window.AndroidBridge.finishFile(id);
            toast(where ? '✅ Guardado en ' + where : '✅ Archivo listo');
            return;
        }
        var file;
        try { file = new File([blob], fileName, { type: mime }); } catch (e) { file = null; }
        if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
            try { await navigator.share({ title: fileName, files: [file] }); toast('✅ Archivo compartido'); return; }
            catch (e) { if (e && e.name === 'AbortError') return; }
        }
        downloadBlob(blob, fileName);
        toast('✅ Archivo descargado');
    }

    function newId(prefix) {
        return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    return {
        escapeHtml: escapeHtml, toast: toast, open: open, alert: alert, confirm: confirm, prompt: prompt,
        choice: choice, closeTop: closeTop, pushLayer: pushLayer, saveFile: saveFile, newId: newId
    };
})();
