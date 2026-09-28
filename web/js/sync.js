/* Sincronización con Supabase (opcional).
   Estrategia "local primero": todo se guarda en el dispositivo y, si hay sesión
   y conexión, se envían los cambios y se reciben los de otros dispositivos.
   Conflictos: gana la versión modificada más recientemente.
   Se sincroniza el JSON de proyectos y agenda, y los PDF (Supabase Storage,
   carpeta privada por usuario). Fotos, videos y audios nunca salen del dispositivo. */
var Sync = (function() {
    var CFG_KEY = 'misnotas-supabase-config';
    var SES_KEY = 'misnotas-supabase-session';
    var CUR_KEY = 'misnotas-sync-cursors';
    var LAST_KEY = 'misnotas-last-sync';
    var PAGE = 1000, CHUNK = 50;
    var BUCKET = 'documentos';
    var warning = '';

    var adapters = [];
    var listeners = [];
    var state = { status: 'local', message: '', lastSync: +(Data.ls(LAST_KEY) || 0) || null };
    var timer = null, running = false, again = false;

    // ---------- Configuración y sesión ----------
    function readJSON(key) { try { return JSON.parse(Data.ls(key) || 'null'); } catch (e) { return null; } }
    function config() {
        var saved = readJSON(CFG_KEY) || {}, def = window.MISNOTAS_CONFIG || {};
        // Si el usuario pulsó "Cambiar", no se vuelve a aplicar la conexión predeterminada
        if (saved.cleared) return { url: '', key: '' };
        return { url: String(saved.url || def.supabaseUrl || '').trim().replace(/\/+$/, ''), key: String(saved.key || def.supabaseAnonKey || '').trim() };
    }
    function configured() { var c = config(); return !!(c.url && c.key); }
    function setConfig(url, key) {
        var prev = config();
        Data.ls(CFG_KEY, JSON.stringify({ url: url.trim().replace(/\/+$/, ''), key: key.trim() }));
        if (prev.url && prev.url !== config().url) signOut(true);
        refreshStatus();
    }
    function clearConfig() { signOut(true); Data.ls(CFG_KEY, JSON.stringify({ cleared: true })); refreshStatus(); }
    function session() { return readJSON(SES_KEY); }
    function user() { var s = session(); return s ? s.user : null; }

    function setState(status, message) {
        state.status = status; state.message = message || '';
        listeners.forEach(function(fn) { try { fn(state); } catch (e) {} });
    }
    function onChange(fn) { listeners.push(fn); fn(state); }
    function refreshStatus() {
        if (!configured()) setState('local');
        else if (!session()) setState('signed-out');
        else if (state.status === 'local' || state.status === 'signed-out') setState(navigator.onLine ? 'idle' : 'offline');
    }

    // ---------- Autenticación (GoTrue) ----------
    function authMessage(d) {
        var m = (d && (d.error_description || d.msg || d.message || d.error)) || 'No se pudo conectar';
        if (/invalid login/i.test(m)) return 'Correo o contraseña incorrectos.';
        if (/not confirmed/i.test(m)) return 'Confirma tu correo (revisa tu bandeja de entrada) y vuelve a intentar.';
        if (/already registered|already exists/i.test(m)) return 'Ese correo ya tiene una cuenta. Inicia sesión.';
        if (/at least|password should/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
        if (/invalid api key|no api key/i.test(m)) return 'La clave pública (anon key) no es válida.';
        if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera un momento.';
        return m;
    }
    async function authRequest(path, body, bearer) {
        var c = config(), res;
        var headers = { apikey: c.key, 'Content-Type': 'application/json' };
        if (bearer) headers.Authorization = 'Bearer ' + bearer;
        try { res = await fetch(c.url + '/auth/v1/' + path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }); }
        catch (e) { throw new Error('Sin conexión con Supabase. Revisa la URL y tu internet.'); }
        var data = await res.json().catch(function() { return {}; });
        if (!res.ok) { var err = new Error(authMessage(data)); err.status = res.status; throw err; }
        return data;
    }
    function storeTokens(d) {
        var u = d.user || (session() || {}).user;
        Data.ls(SES_KEY, JSON.stringify({
            access_token: d.access_token, refresh_token: d.refresh_token,
            expires_at: Date.now() + (d.expires_in || 3600) * 1000,
            user: { id: u.id, email: u.email }
        }));
    }
    async function signIn(email, password) {
        var d = await authRequest('token?grant_type=password', { email: email.trim(), password: password });
        storeTokens(d);
        resetMarks();
        setState('idle');
        schedule(0);
    }
    async function signUp(email, password) {
        var d = await authRequest('signup', { email: email.trim(), password: password });
        if (d.access_token) { storeTokens(d); resetMarks(); setState('idle'); schedule(0); return true; }
        return false; // requiere confirmar el correo
    }
    async function refreshToken() {
        var s = session();
        if (!s) throw authError();
        try { storeTokens(await authRequest('token?grant_type=refresh_token', { refresh_token: s.refresh_token })); }
        catch (e) { if (e.status === 400 || e.status === 401) { Data.ls(SES_KEY, null); throw authError(); } throw e; }
    }
    function authError() { var e = new Error('Tu sesión expiró. Vuelve a iniciar sesión.'); e.auth = true; return e; }
    function signOut(silent) {
        var s = session();
        if (s && configured()) authRequest('logout', {}, s.access_token).catch(function() {});
        Data.ls(SES_KEY, null);
        resetMarks();
        if (!silent) refreshStatus();
    }
    // Al cambiar de cuenta todo lo local se vuelve a enviar y se descarga todo de nuevo.
    function resetMarks() {
        Data.ls(CUR_KEY, null);
        adapters.forEach(function(a) { if (a.resetMarks) a.resetMarks(); });
    }
    async function token() {
        var s = session();
        if (!s) throw authError();
        if (s.expires_at - 60000 < Date.now()) await refreshToken();
        return session().access_token;
    }

    // ---------- REST (PostgREST) ----------
    async function rest(method, query, body, prefer, retried) {
        var c = config(), t = await token(), res;
        var headers = { apikey: c.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
        if (prefer) headers.Prefer = prefer;
        try { res = await fetch(c.url + '/rest/v1/' + query, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }); }
        catch (e) { var ne = new Error('Sin conexión'); ne.offline = true; throw ne; }
        if (res.status === 401 && !retried) { await refreshToken(); return rest(method, query, body, prefer, true); }
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
    async function storageFetch(method, path, opts, retried) {
        opts = opts || {};
        var c = config(), t = await token(), res;
        var headers = Object.assign({ apikey: c.key, Authorization: 'Bearer ' + t }, opts.headers || {});
        try { res = await fetch(c.url + '/storage/v1/' + path, { method: method, headers: headers, body: opts.body }); }
        catch (e) { var ne = new Error('Sin conexión'); ne.offline = true; throw ne; }
        if (res.status === 401 && !retried) { await refreshToken(); return storageFetch(method, path, opts, true); }
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
    // adapter: { table, list(), stamp(item), isDirty(item), toData(item), markClean([{id, stamp}]), applyRemote(rows), resetMarks() }
    function register(adapter) { adapters.push(adapter); }

    async function syncTable(a) {
        var cursors = readJSON(CUR_KEY) || {};
        var since = cursors[a.table];
        // 1) Descargar cambios de otros dispositivos
        for (;;) {
            var q = a.table + '?select=id,data,deleted,client_updated_at,updated_at&order=updated_at.asc&limit=' + PAGE;
            if (since) q += '&updated_at=gt.' + encodeURIComponent(new Date(new Date(since).getTime() - 3000).toISOString());
            var rows = await rest('GET', q);
            if (rows.length) {
                await a.applyRemote(rows);
                var last = rows[rows.length - 1].updated_at;
                if (last === since) break;
                since = last;
                cursors[a.table] = since;
                Data.ls(CUR_KEY, JSON.stringify(cursors));
            }
            if (rows.length < PAGE) break;
        }
        // 2) Subir archivos (PDF) que el adaptador necesite antes de enviar el JSON
        if (a.beforePush) await a.beforePush();
        // 3) Enviar cambios locales y borrados
        var uidv = user().id;
        var dirty = a.list().filter(a.isDirty);
        var tombs = await Data.tombstones(a.table);
        var payload = dirty.map(function(it) {
            return { user_id: uidv, id: it.id, data: a.toData(it), deleted: false, client_updated_at: a.stamp(it) };
        }).concat(tombs.map(function(t) {
            return { user_id: uidv, id: t.id, data: {}, deleted: true, client_updated_at: t.at };
        }));
        for (var i = 0; i < payload.length; i += CHUNK) {
            await rest('POST', a.table + '?on_conflict=user_id,id', payload.slice(i, i + CHUNK), 'resolution=merge-duplicates,return=minimal');
        }
        if (dirty.length) await a.markClean(dirty.map(function(it) { return { id: it.id, stamp: a.stamp(it) }; }));
        if (tombs.length) await Data.clearTombstones(a.table, tombs.map(function(t) { return t.id; }));
    }

    async function syncNow() {
        clearTimeout(timer);
        if (!configured()) return setState('local');
        if (!session()) return setState('signed-out');
        if (!navigator.onLine) return setState('offline');
        if (running) { again = true; return; }
        running = true;
        warning = '';
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
            else if (e.auth) setState('signed-out', e.message);
            else if (e.bucketMissing) setState('error', 'Falta el espacio "documentos" en Supabase Storage: ejecuta de nuevo supabase/schema.sql.');
            else if (e.code === '42P01' || e.code === 'PGRST205' || e.status === 404) setState('error', 'Faltan las tablas en Supabase: ejecuta el archivo supabase/schema.sql en el editor SQL.');
            else if (e.status === 403 || e.code === '42501') setState('error', 'Supabase rechazó los datos (revisa las políticas RLS del schema.sql).');
            else setState('error', e.message);
        } finally {
            running = false;
            if (again) { again = false; schedule(400); }
        }
    }
    function schedule(delay) {
        if (!configured() || !session()) return;
        clearTimeout(timer);
        timer = setTimeout(syncNow, delay == null ? 1500 : delay);
    }

    window.addEventListener('online', function() { schedule(0); });
    window.addEventListener('offline', function() { if (session()) setState('offline'); });
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') schedule(300); });
    setInterval(function() { if (document.visibilityState === 'visible') schedule(0); }, 90000);

    // ---------- Textos de estado ----------
    var LABELS = {
        local: { icon: 'phone', text: 'Solo en este dispositivo' },
        'signed-out': { icon: 'cloudOff', text: 'Nube sin sesión' },
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
            var hadUser = false;
            function render(msg, isError) {
                var c = config(), u = user(), dev = Data.device(), typed = {};
                hadUser = !!u;
                ['url', 'key', 'email'].forEach(function(k) { var el = dlg.querySelector('[data-' + k + ']'); if (el) typed[k] = el.value; });
                var h = '<div class="ui-head"><h3>Nube y dispositivo</h3><button class="ui-x" data-close aria-label="Cerrar">' + Icons.svg('close') + '</button></div>';
                h += statusHtml();
                if (!configured()) {
                    h += '<p class="ui-help">Conecta tu proyecto de <b>Supabase</b> para guardar tus proyectos, sus PDF y tu agenda también en la nube y verlos en otros dispositivos. Las fotos, videos y audios se quedan en el dispositivo donde se capturaron.</p>' +
                        '<label class="ui-field"><span>URL del proyecto</span><input data-url type="url" inputmode="url" placeholder="https://xxxxxxxx.supabase.co" value="' + esc(c.url) + '"></label>' +
                        '<label class="ui-field"><span>Clave pública (anon key)</span><input data-key type="text" autocomplete="off" spellcheck="false" placeholder="eyJhbGciOi…" value="' + esc(c.key) + '"></label>' +
                        '<div class="ui-actions"><button class="btn" data-save-cfg>Conectar</button></div>';
                } else if (!u) {
                    h += '<div class="ui-kv"><span>Proyecto</span><b>' + esc(c.url.replace(/^https?:\/\//, '')) + '</b><button class="ui-link" data-change-cfg>Cambiar</button></div>' +
                        '<label class="ui-field"><span>Correo</span><input data-email type="email" autocomplete="email" inputmode="email" placeholder="tu@correo.com"></label>' +
                        '<label class="ui-field"><span>Contraseña</span><input data-pass type="password" autocomplete="current-password" placeholder="Mínimo 6 caracteres"></label>' +
                        '<div class="ui-actions"><button class="btn btn-ghost" data-signup>Crear cuenta</button><button class="btn" data-signin>Iniciar sesión</button></div>';
                } else {
                    h += '<div class="ui-kv"><span>Proyecto</span><b>' + esc(c.url.replace(/^https?:\/\//, '')) + '</b></div>' +
                        '<div class="ui-actions ui-actions-split"><button class="btn btn-ghost" data-signout>' + Icons.svg('logout') + 'Cerrar sesión</button><button class="btn" data-sync>' + Icons.svg('sync') + 'Sincronizar ahora</button></div>';
                }
                h += '<hr class="ui-sep"><label class="ui-field"><span>Nombre de este dispositivo</span><input data-device value="' + esc(dev.name) + '" placeholder="Ej. Celular de trabajo"></label>' +
                    '<p class="ui-help ui-help-sm">Aparece en la multimedia capturada aquí, para saber en qué equipo quedó guardada.</p>';
                if (msg) h += '<p class="ui-msg' + (isError ? ' ui-msg-error' : '') + '">' + esc(msg) + '</p>';
                dlg.innerHTML = h;
                Object.keys(typed).forEach(function(k) { var el = dlg.querySelector('[data-' + k + ']'); if (el && typed[k]) el.value = typed[k]; });
                bind();
            }
            function statusHtml() {
                var u = user(), l = label();
                return '<div class="ui-status ui-status-' + state.status + '">' + Icons.svg(l.icon) + '<div><strong>' + l.text + '</strong>' +
                    (u ? '<span>' + esc(u.email) + ' · última sincronización ' + relTime(state.lastSync) + '</span>' : '') +
                    (state.message ? '<span class="ui-status-msg">' + esc(state.message) + '</span>' : '') + '</div></div>';
            }
            function busy(btn, on) { if (btn) { btn.disabled = on; btn.classList.toggle('is-busy', on); } }
            function bind() {
                var q = function(s) { return dlg.querySelector(s); };
                q('[data-close]').addEventListener('click', function() { if (off) off(); close(); });
                q('[data-device]').addEventListener('change', function(e) { Data.setDeviceName(e.target.value); });
                var sc = q('[data-save-cfg]');
                if (sc) sc.addEventListener('click', function() {
                    var url = q('[data-url]').value.trim(), key = q('[data-key]').value.trim();
                    if (!/^https:\/\/.+/.test(url) || key.length < 20) return render('Revisa la URL (debe empezar con https://) y la clave pública.', true);
                    setConfig(url, key); render('Conexión guardada. Ahora inicia sesión o crea tu cuenta.');
                });
                var cc = q('[data-change-cfg]');
                if (cc) cc.addEventListener('click', function() { clearConfig(); render(); });
                var si = q('[data-signin]'), su = q('[data-signup]');
                function creds() { return { e: q('[data-email]').value, p: q('[data-pass]').value }; }
                if (si) si.addEventListener('click', async function() {
                    var c = creds(); if (!c.e || !c.p) return render('Escribe tu correo y contraseña.', true);
                    busy(si, true);
                    try { await signIn(c.e, c.p); render('Sesión iniciada. Sincronizando…'); }
                    catch (e) { render(e.message, true); }
                });
                if (su) su.addEventListener('click', async function() {
                    var c = creds(); if (!c.e || !c.p) return render('Escribe tu correo y una contraseña.', true);
                    busy(su, true);
                    try { var ok = await signUp(c.e, c.p); render(ok ? 'Cuenta creada. Sincronizando…' : 'Te enviamos un correo de confirmación. Confírmalo y luego inicia sesión aquí.'); }
                    catch (e) { render(e.message, true); }
                });
                var so = q('[data-signout]');
                if (so) so.addEventListener('click', function() { signOut(); render('Sesión cerrada. Tus datos siguen guardados en este dispositivo.'); });
                var sy = q('[data-sync]');
                if (sy) sy.addEventListener('click', function() { syncNow(); });
            }
            render();
            off = (function() {
                // Solo se actualiza el recuadro de estado para no borrar lo que se está escribiendo
                var fn = function() {
                    if (!dlg.isConnected) return;
                    if (!!user() !== hadUser) { hadUser = !!user(); return render(); }
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
        register: register, syncNow: syncNow, schedule: schedule, onChange: onChange, state: function() { return state; },
        storage: storage, warn: warn, progress: progress,
        label: label, relTime: relTime, configured: configured, user: user, openSettings: openSettings,
        signIn: signIn, signUp: signUp, signOut: signOut, setConfig: setConfig
    };
})();
