/* Sincronización con Supabase (uso personal, sin inicio de sesión).
   Estrategia "local primero": todo se guarda en el dispositivo y, con conexión,
   se envían los cambios y se reciben los de tus otros dispositivos.
   Conflictos: gana la versión modificada más recientemente.
   Se sincroniza el JSON de proyectos y agenda, y los PDF (Supabase Storage).
   Fotos, videos y audios nunca salen del dispositivo. */
var Sync = (function() {
    var CFG_KEY = 'misnotas-supabase-config';
    var CUR_KEY = 'misnotas-sync-cursors-v3';
    var LAST_KEY = 'misnotas-last-sync';
    var SCHEMA_KEY = 'misnotas-sync-schema';
    var SCHEMA = '3';
    var PAGE = 1000, CHUNK = 50;
    var BUCKET = 'documentos';
    var OWNER = 'personal';          // carpeta de los PDF en Storage
    var TABLES = { validation_projects: 'mn_proyectos', agenda_notes: 'mn_agenda' };
    var warning = '';

    var adapters = [];
    var listeners = [];
    var state = { status: 'local', message: '', lastSync: +(Data.ls(LAST_KEY) || 0) || null };
    var timer = null, running = false, again = false;

    // ---------- Configuración ----------
    function readJSON(key) { try { return JSON.parse(Data.ls(key) || 'null'); } catch (e) { return null; } }
    function config() {
        var saved = readJSON(CFG_KEY) || {}, def = window.MISNOTAS_CONFIG || {};
        if (saved.cleared) return { url: '', key: '' };
        return {
            url: String(saved.url || def.supabaseUrl || '').trim().replace(/\/+$/, ''),
            key: String(saved.key || def.supabaseAnonKey || '').trim()
        };
    }
    function configured() { var c = config(); return !!(c.url && c.key); }
    function setConfig(url, key) {
        var prev = config();
        Data.ls(CFG_KEY, JSON.stringify({ url: url.trim().replace(/\/+$/, ''), key: key.trim() }));
        if (prev.url !== config().url) resetMarks();
        refreshStatus();
        schedule(0);
    }
    function clearConfig() { Data.ls(CFG_KEY, JSON.stringify({ cleared: true })); resetMarks(); refreshStatus(); }
    // Dueño de los archivos en Storage (null si no hay nube configurada)
    function owner() { return configured() ? OWNER : null; }

    function setState(status, message) {
        state.status = status; state.message = message || '';
        listeners.forEach(function(fn) { try { fn(state); } catch (e) {} });
    }
    function onChange(fn) { listeners.push(fn); fn(state); }
    function refreshStatus() {
        if (!configured()) setState('local');
        else if (state.status === 'local') setState(navigator.onLine ? 'idle' : 'offline');
    }
    // Al cambiar de proyecto de Supabase todo lo local se vuelve a enviar y se descarga todo de nuevo.
    function resetMarks() {
        Data.ls(CUR_KEY, null);
        adapters.forEach(function(a) { if (a.resetMarks) a.resetMarks(); });
    }

    function headers(extra) {
        var c = config();
        return Object.assign({ apikey: c.key, Authorization: 'Bearer ' + c.key }, extra || {});
    }

    // ---------- REST (PostgREST) ----------
    async function rest(method, query, body, prefer) {
        var c = config(), res;
        var h = headers({ 'Content-Type': 'application/json' });
        if (prefer) h.Prefer = prefer;
        try { res = await fetch(c.url + '/rest/v1/' + query, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }); }
        catch (e) { var ne = new Error('Sin conexión'); ne.offline = true; throw ne; }
        if (!res.ok) {
            var d = await res.json().catch(function() { return {}; });
            var err = new Error(d.message || ('Error ' + res.status));
            err.status = res.status; err.code = d.code;
            throw err;
        }
        return method === 'GET' ? res.json() : null;
    }

    // ---------- Almacenamiento de archivos (Supabase Storage) ----------
    function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
    async function storageFetch(method, path, opts) {
        opts = opts || {};
        var c = config(), res;
        try { res = await fetch(c.url + '/storage/v1/' + path, { method: method, headers: headers(opts.headers), body: opts.body }); }
        catch (e) { var ne = new Error('Sin conexión'); ne.offline = true; throw ne; }
        if (!res.ok) {
            var d = await res.json().catch(function() { return {}; });
            var msg = d.message || d.error || ('Error ' + res.status);
            var err = new Error(msg);
            err.status = +d.statusCode || res.status;
            if (/bucket not found/i.test(msg)) err.bucketMissing = true;
            if (err.status === 413 || /too large|maximum allowed size|exceeded/i.test(msg)) err.tooLarge = true;
            throw err;
        }
        return res;
    }
    var storage = {
        upload: function(path, blob, mime) {
            return storageFetch('POST', 'object/' + BUCKET + '/' + encodePath(path), {
                headers: { 'Content-Type': mime || blob.type || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '3600' },
                body: blob
            });
        },
        // Descarga con progreso (onProgress recibe 0..1 cuando el servidor informa el tamaño)
        download: async function(path, onProgress) {
            var res = await storageFetch('GET', 'object/authenticated/' + BUCKET + '/' + encodePath(path));
            var total = +res.headers.get('content-length') || 0, type = res.headers.get('content-type') || 'application/pdf';
            if (!res.body || !res.body.getReader) return res.blob();
            var reader = res.body.getReader(), chunks = [], got = 0;
            for (;;) {
                var r = await reader.read();
                if (r.done) break;
                chunks.push(r.value); got += r.value.length;
                if (onProgress && total) onProgress(Math.min(1, got / total), got, total);
            }
            return new Blob(chunks, { type: type.split(';')[0] });
        },
        remove: function(paths) {
            return storageFetch('DELETE', 'object/' + BUCKET, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
        }
    };
    // Aviso no fatal (p. ej. un PDF demasiado grande): se muestra pero la sincronización continúa
    function warn(msg) { warning = msg; }
    function progress(msg) { if (state.status === 'syncing') setState('syncing', msg); }

    // ---------- Motor de sincronización ----------
    // adapter: { table, list(), stamp(item), isDirty(item), toData(item), markClean([{id, stamp}]), applyRemote(rows), resetMarks(), beforePush(), afterSync() }
    function register(adapter) { adapters.push(adapter); }

    async function syncTable(a) {
        var cursors = readJSON(CUR_KEY) || {};
        var table = TABLES[a.table] || a.table, since = cursors[table];
        // 1) Descargar cambios de otros dispositivos
        for (;;) {
            var q = table + '?select=id,data,deleted,client_updated_at,updated_at&order=updated_at.asc&limit=' + PAGE;
            if (since) q += '&updated_at=gt.' + encodeURIComponent(new Date(new Date(since).getTime() - 3000).toISOString());
            var rows = await rest('GET', q);
            if (rows.length) {
                await a.applyRemote(rows);
                var last = rows[rows.length - 1].updated_at;
                if (last === since) break;
                since = last;
                cursors[table] = since;
                Data.ls(CUR_KEY, JSON.stringify(cursors));
            }
            if (rows.length < PAGE) break;
        }
        // 2) Subir archivos (PDF) que el adaptador necesite antes de enviar el JSON
        if (a.beforePush) await a.beforePush();
        // 3) Enviar cambios locales y borrados
        var dirty = a.list().filter(a.isDirty);
        var tombs = await Data.tombstones(a.table);
        var payload = dirty.map(function(it) {
            return { id: it.id, data: a.toData(it), deleted: false, client_updated_at: a.stamp(it) };
        }).concat(tombs.map(function(t) {
            return { id: t.id, data: {}, deleted: true, client_updated_at: t.at };
        }));
        for (var i = 0; i < payload.length; i += CHUNK) {
            await rest('POST', table + '?on_conflict=id', payload.slice(i, i + CHUNK), 'resolution=merge-duplicates,return=minimal');
        }
        if (dirty.length) await a.markClean(dirty.map(function(it) { return { id: it.id, stamp: a.stamp(it) }; }));
        if (tombs.length) await Data.clearTombstones(a.table, tombs.map(function(t) { return t.id; }));
    }

    async function syncNow() {
        clearTimeout(timer);
        if (!configured()) return setState('local');
        if (!navigator.onLine) return setState('offline');
        if (running) { again = true; return; }
        running = true;
        warning = '';
        // Al actualizar desde versiones anteriores (con cuenta o código) se reenvía todo a las tablas nuevas
        if (Data.ls(SCHEMA_KEY) !== SCHEMA) { resetMarks(); Data.ls(SCHEMA_KEY, SCHEMA); }
        setState('syncing');
        try {
            for (var i = 0; i < adapters.length; i++) await syncTable(adapters[i]);
            state.lastSync = Date.now();
            Data.ls(LAST_KEY, String(state.lastSync));
            if (warning) setState('error', warning); else setState('synced');
            adapters.forEach(function(a) { if (a.afterSync) { try { a.afterSync(); } catch (e) {} } });
        } catch (e) {
            console.warn('Sync', e);
            if (e.offline) setState('offline');
            else if (e.bucketMissing) setState('error', 'Falta el espacio "documentos" en Supabase Storage: ejecuta supabase/schema.sql.');
            else if (e.code === '42P01' || e.code === 'PGRST205' || e.status === 404) setState('error', 'Faltan las tablas en Supabase: ejecuta el archivo supabase/schema.sql en el editor SQL.');
            else if (e.status === 401 || e.status === 403 || e.code === '42501') setState('error', 'Supabase rechazó los datos: ejecuta supabase/schema.sql actualizado.');
            else setState('error', e.message);
        } finally {
            running = false;
            if (again) { again = false; schedule(400); }
        }
    }
    function schedule(delay) {
        if (!configured()) return;
        clearTimeout(timer);
        timer = setTimeout(syncNow, delay == null ? 1500 : delay);
    }

    window.addEventListener('online', function() { schedule(0); });
    window.addEventListener('offline', function() { if (configured()) setState('offline'); });
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') schedule(300); });
    setInterval(function() { if (document.visibilityState === 'visible') schedule(0); }, 90000);

    // ---------- Textos de estado ----------
    var LABELS = {
        local: { icon: 'phone', text: 'Solo en este dispositivo' },
        idle: { icon: 'cloud', text: 'Nube conectada' },
        syncing: { icon: 'sync', text: 'Sincronizando…' },
        synced: { icon: 'cloudCheck', text: 'Sincronizado' },
        offline: { icon: 'cloudOff', text: 'Sin conexión' },
        error: { icon: 'cloudAlert', text: 'Error al sincronizar' }
    };
    function label(s) { return LABELS[(s || state).status] || LABELS.local; }

    function relTime(ts) {
        if (!ts) return 'nunca';
        var d = (Date.now() - ts) / 1000;
        if (d < 45) return 'hace un momento';
        if (d < 3600) return 'hace ' + Math.round(d / 60) + ' min';
        var dt = new Date(ts), now = new Date();
        var hm = dt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        if (dt.toDateString() === now.toDateString()) return 'hoy, ' + hm;
        return dt.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ', ' + hm;
    }

    // ---------- Pantalla de ajustes ----------
    function openSettings() {
        var esc = UI.escapeHtml, off = null;
        UI.open(function(dlg, close) {
            dlg.classList.add('ui-dialog-form');
            function statusHtml() {
                var l = label();
                return '<div class="ui-status ui-status-' + state.status + '">' + Icons.svg(l.icon) + '<div><strong>' + l.text + '</strong>' +
                    (configured() ? '<span>Última sincronización ' + relTime(state.lastSync) + '</span>' : '') +
                    (state.message ? '<span class="ui-status-msg">' + esc(state.message) + '</span>' : '') + '</div></div>';
            }
            function render(msg, isError) {
                var c = config(), dev = Data.device();
                var h = '<div class="ui-head"><h3>Nube y dispositivo</h3><button class="ui-x" data-close aria-label="Cerrar">' + Icons.svg('close') + '</button></div>';
                h += statusHtml();
                if (!configured()) {
                    h += '<p class="ui-help">Conecta tu proyecto de <b>Supabase</b> para guardar proyectos, PDF y agenda en la nube y verlos en tus otros dispositivos.</p>' +
                        '<label class="ui-field"><span>URL del proyecto</span><input data-url type="url" inputmode="url" placeholder="https://xxxxxxxx.supabase.co" value="' + esc(c.url) + '"></label>' +
                        '<label class="ui-field"><span>Clave pública (anon key)</span><input data-key type="text" autocomplete="off" spellcheck="false" placeholder="eyJhbGciOi…"></label>' +
                        '<div class="ui-actions"><button class="btn" data-save-cfg>Conectar</button></div>';
                } else {
                    h += '<div class="ui-kv"><span>Proyecto</span><b>' + esc(c.url.replace(/^https?:\/\//, '')) + '</b><button class="ui-link" data-change-cfg>Cambiar</button></div>' +
                        '<p class="ui-help ui-help-sm">Proyectos, PDF y agenda se guardan automáticamente en tu Supabase, sin iniciar sesión.</p>' +
                        '<div class="ui-actions"><button class="btn" data-sync>' + Icons.svg('sync') + 'Sincronizar ahora</button></div>';
                }
                h += '<hr class="ui-sep"><label class="ui-field"><span>Nombre de este dispositivo</span><input data-device value="' + esc(dev.name) + '" placeholder="Ej. Celular de trabajo"></label>' +
                    '<p class="ui-help ui-help-sm">Aparece en la multimedia capturada aquí, para saber en qué equipo quedó guardada.</p>';
                if (msg) h += '<p class="ui-msg' + (isError ? ' ui-msg-error' : '') + '">' + esc(msg) + '</p>';
                dlg.innerHTML = h;
                var q = function(s) { return dlg.querySelector(s); };
                q('[data-close]').addEventListener('click', function() { if (off) off(); close(); });
                q('[data-device]').addEventListener('change', function(e) { Data.setDeviceName(e.target.value); });
                var sc = q('[data-save-cfg]');
                if (sc) sc.addEventListener('click', function() {
                    var url = q('[data-url]').value.trim(), key = q('[data-key]').value.trim();
                    if (!/^https:\/\/.+/.test(url) || key.length < 20) return render('Revisa la URL (debe empezar con https://) y la clave pública.', true);
                    setConfig(url, key); render('Conectado. Sincronizando…');
                });
                var cc = q('[data-change-cfg]');
                if (cc) cc.addEventListener('click', function() { clearConfig(); render(); });
                var sy = q('[data-sync]');
                if (sy) sy.addEventListener('click', function() { syncNow(); });
            }
            render();
            off = (function() {
                // Solo se actualiza el recuadro de estado para no borrar lo que se está escribiendo
                var fn = function() {
                    if (!dlg.isConnected) return;
                    var box = dlg.querySelector('.ui-status');
                    if (box) box.outerHTML = statusHtml();
                };
                listeners.push(fn);
                return function() { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
            })();
        }, function() { if (off) off(); });
    }

    refreshStatus();

    return {
        owner: owner, configured: configured, setConfig: setConfig,
        register: register, syncNow: syncNow, schedule: schedule, onChange: onChange, state: function() { return state; },
        storage: storage, warn: warn, progress: progress,
        label: label, relTime: relTime, openSettings: openSettings
    };
})();
