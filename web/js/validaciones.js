/* Validaciones: proyectos de revisión de documentos PDF con observaciones
   (nota, reemplazo de texto, foto, video, audio y tiempo), estados
   pendiente/resuelta, sincronización con Supabase y opciones para compartir. */
var Validaciones = (function() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

    var TABLE = 'validation_projects';
    var TYPES = {
        text: { label: 'Nota', icon: 'note', field: 'Nota', ph: 'Describe la observación…' },
        replacement: { label: 'Reemplazo', icon: 'strike', field: 'Reemplazar por', ph: 'Escribe el texto correcto…' },
        photo: { label: 'Foto', icon: 'camera', field: 'Descripción', ph: '¿Qué muestra la foto?' },
        video: { label: 'Video', icon: 'video', field: 'Descripción', ph: '¿Qué muestra el video?' },
        audio: { label: 'Audio', icon: 'mic', field: 'Descripción', ph: '¿De qué trata el audio?' },
        timer: { label: 'Tiempo', icon: 'stopwatch', field: 'Qué se midió', ph: 'Ej. tiempo de respuesta del sistema…' }
    };
    var TYPE_ORDER = ['text', 'replacement', 'photo', 'video', 'audio', 'timer'];
    var TOOLS = [
        { id: 'select', label: 'Mover', icon: 'cursor', key: 'v' },
        'sep',
        { id: 'text', label: 'Nota', icon: 'note', key: 'n', hint: 'Toca el documento donde va la nota' },
        { id: 'replacement', label: 'Tachar', icon: 'strike', key: 't', hint: 'Selecciona en el documento el texto a reemplazar' },
        { id: 'photo', label: 'Foto', icon: 'camera', key: 'f', hint: 'Toca el punto al que corresponde la foto' },
        { id: 'video', label: 'Video', icon: 'video', key: 'g', hint: 'Toca el punto al que corresponde el video' },
        { id: 'audio', label: 'Audio', icon: 'mic', key: 'a', hint: 'Toca el punto al que corresponde el audio' },
        { id: 'timer', label: 'Tiempo', icon: 'stopwatch', key: 'c', hint: 'Toca el punto al que corresponde la medición' }
    ];

    var projects = [], localPdfs = {};
    var current = null, pdfDoc = null, page = 1, loadToken = 0;
    var pdfScale = 1, renderedScale = 1, autoFit = true, rendering = false, pendingRender = null, renderTimer = null;
    var tool = 'select', pendingPoint = null, selectedId = null, panelOpen = false;
    var dash = { q: '', filter: 'all', sort: 'recent' };
    var pf = { status: 'all', type: 'all' };
    var urlCache = {}, saveTimer = null, textTimer = null, downloads = {}, prefetching = false, warnedTooLarge = {};
    var DELETES_KEY = 'misnotas-storage-deletes';
    var esc = UI.escapeHtml, ic = Icons.svg;
    var $ = function(id) { return document.getElementById(id); };

    // ---------- Utilidades ----------
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function isWide() { return window.matchMedia('(min-width: 1200px)').matches; }
    function isTouch() { return window.matchMedia('(pointer: coarse)').matches; }
    function isEditorOpen() { return !$('vx-editor').classList.contains('hidden'); }
    function byId(id) { return projects.find(function(p) { return p.id === id; }); }
    function trunc(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function fmtDate(ts) {
        if (!ts) return '';
        var d = new Date(ts), now = new Date();
        return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined }) +
            ', ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    }
    function annotationsOf(p) {
        var out = [];
        Object.keys((p && p.annotations) || {}).sort(function(a, b) { return a - b; }).forEach(function(pg) {
            (p.annotations[pg] || []).forEach(function(a) { out.push({ a: a, page: +pg }); });
        });
        return out;
    }
    function stats(p) {
        var s = { total: 0, open: 0, done: 0 };
        annotationsOf(p).forEach(function(x) { s.total++; if (x.a.status === 'done') s.done++; else s.open++; });
        return s;
    }
    function findAnn(id) {
        if (!current) return null;
        for (var pg in current.annotations) {
            var list = current.annotations[pg], i = list.findIndex(function(a) { return a.id === id; });
            if (i !== -1) return { a: list[i], page: +pg, index: i };
        }
        return null;
    }
    function dialogHead(title) { return '<div class="ui-head"><h3>' + esc(title) + '</h3><button class="ui-x" data-x aria-label="Cerrar">' + ic('close') + '</button></div>'; }
    function pickMime(list) {
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
        return list.find(function(m) { return MediaRecorder.isTypeSupported(m); }) || '';
    }
    async function mediaUrl(key) {
        if (urlCache[key]) return urlCache[key];
        var b = await Data.getBlob(key);
        if (!b) return null;
        return (urlCache[key] = URL.createObjectURL(b));
    }
    // Versión del PDF: su huella SHA-256 (o un id si el navegador no puede calcularla)
    function pdfVer(p) { return p.pdf ? (p.pdf.hash || p.pdf.ver || 'v0') : null; }
    function ownPath(path) { var u = Sync.user(); return !!(u && path && path.indexOf(u.id + '/') === 0); }
    function pdfInCloud(p) { return !!(p.pdf && p.pdf.remotePath && p.pdf.remoteHash === pdfVer(p)); }
    function pendingDeletes() { try { return JSON.parse(Data.ls(DELETES_KEY) || '[]'); } catch (e) { return []; } }
    function queueDelete(path) { var l = pendingDeletes(); if (l.indexOf(path) === -1) l.push(path); Data.ls(DELETES_KEY, JSON.stringify(l)); }
    function clearDeletes(done) { Data.ls(DELETES_KEY, JSON.stringify(pendingDeletes().filter(function(x) { return done.indexOf(x) === -1; }))); }
    function canPrefetch() {
        var c = navigator.connection;
        return !c || (!c.saveData && c.type !== 'cellular');
    }
    // Descarga el PDF de un proyecto desde la nube (una sola descarga a la vez por proyecto)
    function downloadPdf(p, onProgress) {
        if (downloads[p.id]) return downloads[p.id];
        var path = p.pdf.remotePath;
        downloads[p.id] = Sync.storage.download(path, onProgress).then(async function(blob) {
            if (p.pdf && p.pdf.remotePath === path) {
                await Data.putPdf(p.id, new Blob([blob], { type: 'application/pdf' }));
                localPdfs[p.id] = true;
            }
            return blob;
        }).finally(function() { delete downloads[p.id]; });
        return downloads[p.id];
    }
    async function prefetchPdfs() {
        if (prefetching || !Sync.user() || !canPrefetch()) return;
        prefetching = true;
        try {
            var todo = projects.filter(function(p) { return p.pdf && !localPdfs[p.id] && pdfInCloud(p) && ownPath(p.pdf.remotePath) && (p.pdf.size || 0) < 40e6; });
            for (var i = 0; i < todo.length; i++) {
                try { await downloadPdf(todo[i]); } catch (e) { if (e.offline) break; }
            }
            if (todo.length && !isEditorOpen()) renderDashboard();
        } finally { prefetching = false; }
    }

    function toBlob(f, type) { return f.arrayBuffer().then(function(b) { return new Blob([b], { type: type || f.type || 'application/octet-stream' }); }); }

    // ---------- Guardado local y sincronización ----------
    function persist(now) {
        clearTimeout(saveTimer);
        if (now) return Data.saveProjects(projects);
        saveTimer = setTimeout(function() { Data.saveProjects(projects); }, 250);
        return Promise.resolve();
    }
    function touch(p, opts) {
        p = p || current;
        if (!p) return;
        p.updatedAt = Date.now();
        p._dirty = true;
        persist();
        Sync.schedule();
        if (!opts || !opts.quiet) refreshChrome();
        else refreshCount();
    }
    function refreshChrome() {
        refreshCount();
        if (isEditorOpen() && !$('vx-panel-list').classList.contains('hidden')) renderList();
        if (!isEditorOpen()) renderDashboard();
    }

    async function removeLocal(p, tombstone) {
        annotationsOf(p).forEach(function(x) { if (x.a.media) { Data.delBlob(x.a.media.key); revoke(x.a.media.key); } });
        await Data.delPdf(p.id);
        delete localPdfs[p.id];
        projects = projects.filter(function(x) { return x !== p; });
        if (tombstone) {
            await Data.addTombstone(TABLE, p.id);
            if (p.pdf && p.pdf.remotePath && ownPath(p.pdf.remotePath)) queueDelete(p.pdf.remotePath);
        }
    }
    function revoke(key) { if (urlCache[key]) { URL.revokeObjectURL(urlCache[key]); delete urlCache[key]; } }

    var adapter = {
        table: TABLE,
        list: function() { return projects; },
        stamp: function(p) { return p.updatedAt || 0; },
        isDirty: function(p) { return !!p._dirty || !p._syncedAt; },
        toData: function(p) { var c = JSON.parse(JSON.stringify(p)); delete c._dirty; delete c._syncedAt; return c; },
        markClean: function(items) {
            var now = Date.now();
            items.forEach(function(it) { var p = byId(it.id); if (p && p.updatedAt === it.stamp) { p._dirty = false; p._syncedAt = now; } });
            return persist(true);
        },
        resetMarks: function() { projects.forEach(function(p) { p._syncedAt = null; }); return persist(true); },
        beforePush: async function() {
            var u = Sync.user();
            if (!u) return;
            var dels = pendingDeletes().filter(function(x) { return x.indexOf(u.id + '/') === 0; });
            if (dels.length) {
                try { await Sync.storage.remove(dels); clearDeletes(dels); }
                catch (e) { if (e.offline || e.auth) throw e; }
            }
            for (var i = 0; i < projects.length; i++) {
                var p = projects[i];
                if (!p.pdf || !localPdfs[p.id]) continue;
                var ver = pdfVer(p);
                if (p.pdf.remotePath && ownPath(p.pdf.remotePath) && p.pdf.remoteHash === ver) continue;
                if (p.pdf.skipUpload === ver) continue;
                var blob = await Data.getPdf(p.id);
                if (!blob) continue;
                var path = u.id + '/' + p.id + '/' + String(ver).slice(0, 40) + '.pdf';
                Sync.progress('Subiendo «' + p.pdf.name + '»');
                try { await Sync.storage.upload(path, blob, 'application/pdf'); }
                catch (e) {
                    if (e.offline || e.auth) throw e;
                    if (e.bucketMissing) throw e;
                    if (e.tooLarge) {
                        p.pdf.skipUpload = ver;
                        Sync.warn('«' + p.pdf.name + '» es demasiado grande para tu plan de Supabase; se queda solo en este dispositivo.');
                        if (!warnedTooLarge[p.id]) { warnedTooLarge[p.id] = true; UI.toast('El PDF es demasiado grande para subirlo a la nube', 'error'); }
                        continue;
                    }
                    Sync.warn('No se pudo subir «' + p.pdf.name + '»: ' + e.message);
                    continue;
                }
                var old = p.pdf.remotePath;
                p.pdf.remotePath = path;
                p.pdf.remoteHash = ver;
                delete p.pdf.skipUpload;
                if (old && old !== path && ownPath(old)) queueDelete(old);
                touch(p, { quiet: true });
                if (p === current) renderDocline();
            }
            var more = pendingDeletes().filter(function(x) { return x.indexOf(u.id + '/') === 0; });
            if (more.length) { try { await Sync.storage.remove(more); clearDeletes(more); } catch (e) { if (e.offline) throw e; } }
        },
        afterSync: function() {
            if (!isEditorOpen()) renderDashboard();
            prefetchPdfs();
        },
        applyRemote: async function(rows) {
            var now = Date.now(), changed = false, curChanged = false, curRemoved = false, pdfChanged = false;
            var tombs = await Data.tombstones(TABLE), revived = [];
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i], local = byId(row.id), stamp = +row.client_updated_at || 0;
                var tomb = tombs.find(function(t) { return t.id === row.id; });
                if (tomb && !row.deleted) {
                    // Borrado aquí y aún sin enviar: gana el borrado salvo que la nube tenga un cambio posterior
                    if (stamp <= tomb.at) continue;
                    revived.push(row.id);
                }
                if (row.deleted) {
                    if (local && !(local._dirty && (local.updatedAt || 0) > stamp)) {
                        if (local === current) curRemoved = true;
                        await removeLocal(local, false);
                        changed = true;
                    }
                    continue;
                }
                var data = row.data || {};
                data.id = row.id;
                if (!local) {
                    await Data.migrateProject(data);
                    data.updatedAt = stamp || data.updatedAt;
                    data._dirty = false; data._syncedAt = now;
                    projects.push(data);
                    changed = true;
                } else if (stamp > (local.updatedAt || 0)) {
                    var oldPdf = local.pdf ? JSON.parse(JSON.stringify(local.pdf)) : null, oldVer = pdfVer(local);
                    var pendingUpload = oldPdf && localPdfs[local.id] && oldPdf.remoteHash !== oldVer;
                    Object.keys(local).forEach(function(k) { delete local[k]; });
                    Object.assign(local, data);
                    await Data.migrateProject(local);
                    local.updatedAt = stamp; local._dirty = false; local._syncedAt = now;
                    if (pendingUpload) {
                        // Se adjuntó un PDF aquí que aún no se sube: se conserva y se enviará en esta sincronización
                        local.pdf = oldPdf; local._dirty = true; local.updatedAt = now;
                    } else if (localPdfs[local.id] && pdfVer(local) !== oldVer) {
                        // Otro dispositivo cambió el PDF: se descarta la copia local vieja
                        await Data.delPdf(local.id);
                        delete localPdfs[local.id];
                        if (local === current) pdfChanged = true;
                    }
                    if (local === current) curChanged = true;
                    changed = true;
                } else if (stamp === local.updatedAt) {
                    local._dirty = false;
                    local._syncedAt = local._syncedAt || now;
                }
            }
            if (revived.length) await Data.clearTombstones(TABLE, revived);
            await persist(true);
            if (!changed) return;
            if (curRemoved) { closeEditor(); UI.toast('Este proyecto se eliminó desde otro dispositivo', 'info'); }
            else if (pdfChanged) { refreshFromRemote(); pdfDoc = null; loadDocument(); UI.toast('El PDF se actualizó desde otro dispositivo', 'info'); }
            else if (curChanged) refreshFromRemote();
            if (!isEditorOpen()) renderDashboard();
        }
    };

    function refreshFromRemote() {
        if (document.activeElement !== $('vx-title')) $('vx-title').value = current.name;
        renderDocline();
        renderPins();
        refreshCount();
        if (selectedId && !findAnn(selectedId)) { selectedId = null; showList(); return; }
        var typing = document.activeElement && document.activeElement.id === 'vx-ann-text';
        if (selectedId && !typing) { var f = findAnn(selectedId); showDetail(f.a, f.page); }
        else if (!selectedId) renderList();
    }

    // ---------- Estado de la nube ----------
    function renderSync(s) {
        var l = Sync.label(s), tip = l.text + (s.message ? ' — ' + s.message : '');
        ['vx-sync', 'vx-sync-mini'].forEach(function(id) {
            var el = $(id);
            if (!el) return;
            el.setAttribute('data-status', s.status);
            el.title = tip;
            el.innerHTML = ic(l.icon) + '<span>' + l.text + '</span>';
        });
        if (s.status === 'synced' && !isEditorOpen()) renderDashboard();
    }

    // ================= PANEL DE PROYECTOS =================
    var ILLU = '<svg class="vx-illu" viewBox="0 0 168 120" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
        '<rect x="46" y="8" width="78" height="104" rx="4" fill="var(--surface)"/><path d="M110 8v12h14" opacity=".6"/>' +
        '<path d="M58 30h40M58 40h54M58 60h46M58 70h30M58 80h50M58 90h24" opacity=".45"/>' +
        '<path d="M58 50h38" opacity=".45"/><path d="M56 50h42" stroke="var(--t-replacement)" stroke-width="2"/>' +
        '<path d="M104 47v-9a8 8 0 1 1 8 8z" fill="var(--t-text)" stroke="var(--surface)" stroke-width="2"/>' +
        '<path d="M36 88v-9a8 8 0 1 1 8 8z" fill="var(--t-photo)" stroke="var(--bg)" stroke-width="2"/>' +
        '<path d="M126 100v-9a8 8 0 1 1 8 8z" fill="var(--ok)" stroke="var(--bg)" stroke-width="2"/></svg>';

    function projectMatches(p) {
        var s = stats(p);
        if (dash.filter === 'done' && !(s.total && !s.open)) return false;
        if (dash.filter === 'active' && s.total && !s.open) return false;
        if (!dash.q) return true;
        return ((p.name || '') + ' ' + ((p.pdf && p.pdf.name) || '')).toLowerCase().indexOf(dash.q) !== -1;
    }
    function sorter(a, b) {
        if (dash.sort === 'name') return (a.name || '').localeCompare(b.name || '', 'es');
        if (dash.sort === 'pending') return stats(b).open - stats(a).open || b.updatedAt - a.updatedAt;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    }

    function rowHtml(p) {
        var st = stats(p), pct = st.total ? Math.round(st.done / st.total * 100) : 0, hasPdf = !!localPdfs[p.id];
        var sheet = !p.pdf ? '<span class="vx-sheet is-empty">PDF</span>' : '<span class="vx-sheet' + (hasPdf || pdfInCloud(p) ? '' : ' is-remote') + '">PDF</span>';
        var docName = p.pdf ? esc(p.pdf.name) : 'Sin documento';
        var where = '';
        if (p.pdf) {
            if (!hasPdf) where = pdfInCloud(p) ? 'en la nube' : 'en otro dispositivo';
            else if (Sync.user()) where = pdfInCloud(p) ? 'respaldado' : 'por subir';
        }
        var docMeta = p.pdf ? [p.pdf.pages ? p.pdf.pages + ' págs.' : '', where].filter(Boolean).join(' · ') : 'Agrega un PDF';
        var prog = st.total
            ? '<div class="vx-progress"><div class="vx-bar"><i style="width:' + pct + '%"></i></div><div class="vx-progress-text"><span><b>' + st.done + '/' + st.total + '</b> resueltas</span>' +
              (st.open ? '<span class="vx-chip vx-chip-warn">' + st.open + (st.open === 1 ? ' pendiente' : ' pendientes') + '</span>' : '<span class="vx-chip vx-chip-ok">' + ic('check') + 'Completado</span>') + '</div></div>'
            : '<div class="vx-progress-text"><span class="vx-muted">Sin observaciones todavía</span></div>';
        var pendingSync = p._dirty && Sync.user() ? '<span class="vx-chip" title="Se enviará a la nube cuando haya conexión">' + ic('sync') + 'Por sincronizar</span>' : '';
        return '<div class="vx-row" role="button" tabindex="0" data-id="' + p.id + '">' +
            '<div class="vx-row-main">' + sheet + '<div class="vx-row-text"><span class="vx-row-name">' + esc(p.name || 'Sin nombre') + '</span><span class="vx-row-sub">' + docName + (docMeta ? ' · ' + docMeta : '') + '</span></div></div>' +
            '<div class="vx-row-doc"><span>' + docName + '</span><small>' + (p.pdf && where ? ic(where === 'en otro dispositivo' ? 'phone' : where === 'por subir' ? 'upload' : 'cloud') : '') + docMeta + '</small></div>' +
            '<div class="vx-row-prog">' + prog + '</div>' +
            '<div class="vx-row-date"><span>' + Sync.relTime(p.updatedAt) + '</span>' + pendingSync + '</div>' +
            '<button class="vx-btn vx-btn-icon vx-row-more" data-more aria-label="Opciones del proyecto">' + ic('more') + '</button></div>';
    }

    function renderDashboard() {
        var box = $('vx-list');
        if (!box) return;
        var open = 0;
        projects.forEach(function(p) { open += stats(p).open; });
        $('vx-summary').textContent = projects.length
            ? projects.length + (projects.length === 1 ? ' proyecto' : ' proyectos') + ' · ' + (open ? open + (open === 1 ? ' observación pendiente' : ' observaciones pendientes') : 'todo resuelto')
            : 'Revisión de documentos con observaciones';
        var list = projects.filter(projectMatches).sort(sorter);
        $('vx-table-head').classList.toggle('hidden', !list.length);
        document.querySelector('.vx-filters').classList.toggle('hidden', !projects.length);
        if (!projects.length) {
            box.innerHTML = '<div class="vx-empty">' + ILLU + '<h2>Empieza tu primera validación</h2><p>Carga un PDF y marca sobre el documento notas, textos a reemplazar, fotos, videos, audios y tiempos. Todo queda en tu dispositivo y, si lo conectas, también en la nube.</p>' +
                '<div class="vx-empty-actions"><button class="vx-btn vx-btn-primary" data-empty-new>' + ic('plus') + 'Nuevo proyecto</button><button class="vx-btn vx-btn-quiet" data-empty-import>' + ic('upload') + 'Importar</button></div></div>';
            box.querySelector('[data-empty-new]').addEventListener('click', function() { newProjectDialog(); });
            box.querySelector('[data-empty-import]').addEventListener('click', function() { $('vx-file-import').click(); });
            return;
        }
        if (!list.length) {
            box.innerHTML = '<div class="vx-plist-empty">' + ic('search') + '<p>No hay proyectos que coincidan.</p></div>';
            return;
        }
        box.innerHTML = list.map(rowHtml).join('');
        box.querySelectorAll('.vx-row').forEach(function(row) {
            var p = byId(row.getAttribute('data-id'));
            row.addEventListener('click', function(e) { if (!e.target.closest('[data-more]')) openProject(p.id); });
            row.addEventListener('keydown', function(e) { if (e.key === 'Enter' && e.target === row) openProject(p.id); });
            row.querySelector('[data-more]').addEventListener('click', function(e) { e.stopPropagation(); rowMenu(e.currentTarget, p); });
        });
    }

    async function rowMenu(btn, p) {
        var v = await UI.menu(btn, [
            { label: 'Abrir', icon: 'file', value: 'open' },
            { label: 'Renombrar', icon: 'edit', value: 'rename' },
            { label: 'Compartir y exportar', icon: 'share', value: 'share' },
            { separator: true },
            { label: 'Eliminar proyecto', icon: 'trash', value: 'delete', danger: true }
        ], p.name);
        if (v === 'open') openProject(p.id);
        else if (v === 'rename') {
            var n = await UI.prompt('Renombrar proyecto', p.name);
            if (n && n.trim()) { p.name = n.trim(); touch(p); }
        } else if (v === 'share') openShareMenu(btn, p);
        else if (v === 'delete') deleteProject(p);
    }

    async function deleteProject(p) {
        var st = stats(p);
        var msg = 'Se eliminará «' + p.name + '» con ' + st.total + (st.total === 1 ? ' observación' : ' observaciones') + ' y la multimedia guardada en este dispositivo.' + (Sync.user() ? ' También se quitará de la nube y de tus otros dispositivos.' : '');
        if (!(await UI.confirm(msg, { title: 'Eliminar proyecto', okText: 'Eliminar', danger: true }))) return;
        await removeLocal(p, true);
        await persist(true);
        Sync.schedule();
        if (current === p) closeEditor(); else renderDashboard();
        UI.toast('Proyecto eliminado');
    }

    function newProjectDialog(file) {
        var chosen = file || null;
        UI.open(function(dlg, close) {
            var suggested = chosen ? chosen.name.replace(/\.pdf$/i, '') : 'Validación ' + (projects.length + 1);
            dlg.innerHTML = dialogHead('Nuevo proyecto') +
                '<label class="ui-field"><span>Nombre</span><input data-name value="' + esc(suggested) + '" placeholder="Ej. Contrato proveedor 2026" maxlength="120"></label>' +
                '<div class="vx-filepick"><span class="vx-sheet' + (chosen ? '' : ' is-empty') + '" data-sheet>PDF</span><div><b data-fname>' + (chosen ? esc(chosen.name) : 'Documento PDF') + '</b><small data-fmeta>' + (chosen ? Data.formatBytes(chosen.size) : 'Opcional · puedes agregarlo después') + '</small></div>' +
                '<button class="vx-btn vx-btn-quiet" data-pick>' + (chosen ? 'Cambiar' : 'Elegir PDF') + '</button><input type="file" accept="application/pdf,.pdf" hidden data-file></div>' +
                '<div class="ui-actions"><button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn" data-create>Crear proyecto</button></div>';
            var q = function(s) { return dlg.querySelector(s); };
            q('[data-x]').addEventListener('click', close);
            q('[data-cancel]').addEventListener('click', close);
            q('[data-pick]').addEventListener('click', function() { q('[data-file]').click(); });
            q('[data-file]').addEventListener('change', function(e) {
                var f = e.target.files[0]; if (!f) return;
                var nameInput = q('[data-name]');
                if (!chosen && /^Validación \d+$/.test(nameInput.value)) nameInput.value = f.name.replace(/\.pdf$/i, '');
                chosen = f;
                q('[data-fname]').textContent = f.name;
                q('[data-fmeta]').textContent = Data.formatBytes(f.size);
                q('[data-sheet]').classList.remove('is-empty');
                q('[data-pick]').textContent = 'Cambiar';
            });
            function create() {
                var name = q('[data-name]').value.trim() || suggested;
                close();
                createProject(name, chosen);
            }
            q('[data-create]').addEventListener('click', create);
            q('[data-name]').addEventListener('keydown', function(e) { if (e.key === 'Enter') create(); });
        }, null, 'ui-dialog-form');
    }

    async function createProject(name, file) {
        var now = Date.now();
        var p = { id: Data.uid('proj'), name: name, schema: 2, createdAt: now, updatedAt: now, pdf: null, annotations: {}, seq: 0, _dirty: true };
        projects.push(p);
        if (file) await attachPdf(p, file, true);
        await persist(true);
        Sync.schedule();
        openProject(p.id);
    }

    // ---------- Importar / exportar ----------
    function progressBox(title) {
        var ov = document.createElement('div');
        ov.className = 'ui-overlay';
        ov.innerHTML = '<div class="ui-dialog"><h3>' + esc(title) + '</h3><div class="vx-bar" style="margin:14px 0 8px"><i style="width:0%"></i></div><p class="vx-muted" data-t>Preparando…</p></div>';
        document.body.appendChild(ov);
        return {
            set: function(f, t) { ov.querySelector('.vx-bar i').style.width = Math.round(clamp(f, 0, 1) * 100) + '%'; if (t) ov.querySelector('[data-t]').textContent = t; },
            close: function() { ov.remove(); }
        };
    }

    async function exportBackup() {
        if (!projects.length && !Agenda.getNotes().length) { UI.toast('Todavía no hay datos para respaldar', 'info'); return; }
        var pb = progressBox('Creando respaldo completo');
        try {
            var blob = await Share.backupZip(projects, Agenda.getNotes(), function(f) { pb.set(f, Math.round(f * 100) + '%'); });
            pb.close();
            await UI.saveFile(blob, 'MisNotas_Respaldo_' + new Date().toISOString().slice(0, 10) + '.zip', 'application/zip');
        } catch (e) { pb.close(); UI.alert(e.message, 'No se pudo crear el respaldo'); }
    }

    async function importFile(file) {
        if (/\.zip$/i.test(file.name) || /zip/.test(file.type)) return importBackup(file);
        if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return newProjectDialog(file);
        return importJSON(file);
    }

    async function importBackup(file) {
        var pb = progressBox('Leyendo respaldo'), r;
        try { r = await Share.readBackupZip(file, function(f) { pb.set(f); }); }
        catch (e) { pb.close(); return UI.alert(e.message, 'No se pudo leer el respaldo'); }
        pb.close();
        var mode = await UI.choice('Restaurar respaldo', [
            { label: 'Combinar con lo actual', hint: 'Conserva lo más reciente de cada proyecto y nota', icon: 'layers', value: 'merge', primary: true },
            { label: 'Reemplazar todo', hint: 'Borra lo actual y deja solo el respaldo', icon: 'sync', value: 'replace', danger: true }
        ], r.projects.length + ' proyectos y ' + r.notes.length + ' notas de agenda en el archivo.');
        if (!mode) return;
        if (mode === 'replace' && !(await UI.confirm('Se eliminarán los proyectos y notas actuales que no estén en el respaldo, también en la nube.', { title: 'Reemplazar todo', okText: 'Reemplazar', danger: true }))) return;
        var now = Date.now();
        if (mode === 'replace') {
            var keep = r.projects.map(function(p) { return p.id; });
            var drop = projects.filter(function(p) { return keep.indexOf(p.id) === -1; });
            for (var i = 0; i < drop.length; i++) await removeLocal(drop[i], true);
        }
        r.projects.forEach(function(p) {
            var ex = byId(p.id);
            p._dirty = true; p._syncedAt = null;
            if (!ex) projects.push(p);
            else if (mode === 'replace' || (p.updatedAt || 0) > (ex.updatedAt || 0)) { p.updatedAt = Math.max(p.updatedAt || 0, now); projects[projects.indexOf(ex)] = p; }
        });
        await refreshLocalPdfs();
        await persist(true);
        await Agenda.importNotes(r.notes, mode);
        Sync.schedule();
        renderDashboard();
        UI.toast('Respaldo restaurado');
    }

    async function importJSON(file) {
        var items;
        try { items = await Share.readProjectJSON(file); }
        catch (e) { return UI.alert(e.message, 'No se pudo importar'); }
        var imported = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i], p = it.project;
            if (!p || !p.id) continue;
            delete p._dirty; delete p._syncedAt;
            await Data.migrateProject(p);
            var ex = byId(p.id);
            if (ex) {
                var v = await UI.choice('«' + p.name + '» ya existe', [
                    { label: 'Reemplazar el existente', hint: 'Usa la versión del archivo', icon: 'sync', value: 'replace', primary: true },
                    { label: 'Importar como copia', hint: 'Conserva ambos proyectos', icon: 'layers', value: 'copy' }
                ]);
                if (!v) continue;
                if (v === 'copy') {
                    var oldId = p.id;
                    p.id = Data.uid('proj');
                    p.name = p.name + ' (copia)';
                    if (!it.pdfBlob && localPdfs[oldId]) { var pdf = await Data.getPdf(oldId); if (pdf) await Data.putPdf(p.id, pdf); }
                    ex = null;
                }
            }
            if (it.pdfBlob) {
                await Data.putPdf(p.id, it.pdfBlob);
                if (!p.pdf) p.pdf = { name: it.pdfName || 'documento.pdf', size: it.pdfBlob.size, pages: null, hash: await Data.sha256(it.pdfBlob) };
            }
            var keys = Object.keys(it.media || {});
            for (var k = 0; k < keys.length; k++) await Data.putBlob(keys[k], it.media[keys[k]]);
            p.updatedAt = Date.now(); p._dirty = true; p._syncedAt = null;
            if (ex) projects[projects.indexOf(ex)] = p; else projects.push(p);
            imported.push(p);
        }
        if (!imported.length) return;
        await refreshLocalPdfs();
        await persist(true);
        Sync.schedule();
        renderDashboard();
        UI.toast(imported.length === 1 ? 'Proyecto importado' : imported.length + ' proyectos importados');
        if (imported.length === 1) openProject(imported[0].id);
    }

    async function refreshLocalPdfs() {
        var keys = await localforage.keys();
        localPdfs = {};
        keys.forEach(function(k) { if (k.indexOf('blob_pdf_') === 0) localPdfs[k.slice(9)] = true; });
    }

    // ---------- Compartir ----------
    function lineFor(a) {
        var t = TYPES[a.type] || TYPES.text;
        var s = '#' + a.n + ' ' + t.label + (a.status === 'done' ? ' (resuelta)' : '') + ': ';
        if (a.type === 'replacement') s += 'cambiar "' + trunc(a.originalText, 140) + '" por "' + (a.text ? a.text.trim() : '…') + '"';
        else if (a.type === 'timer') s += (a.time || '') + (a.text ? ' — ' + a.text.trim() : '');
        else if (a.media) s += (a.text ? a.text.trim() : 'sin descripción') + ' [' + t.label.toLowerCase() + ']';
        else s += a.text ? a.text.trim() : 'sin texto';
        return s;
    }
    function summaryText(p, onlyOpen) {
        var st = stats(p), L = ['*' + p.name + '*'];
        if (p.pdf) L.push('Documento: ' + p.pdf.name + (p.pdf.pages ? ' (' + p.pdf.pages + ' págs.)' : ''));
        L.push('Observaciones: ' + st.total + ' · ' + st.open + ' pendientes · ' + st.done + ' resueltas');
        var byPage = {};
        annotationsOf(p).forEach(function(x) {
            if (onlyOpen && x.a.status === 'done') return;
            (byPage[x.page] = byPage[x.page] || []).push(x.a);
        });
        var pages = Object.keys(byPage).sort(function(a, b) { return a - b; });
        pages.forEach(function(pg) { L.push('', '*Página ' + pg + '*'); byPage[pg].forEach(function(a) { L.push(lineFor(a)); }); });
        if (!pages.length) L.push('', onlyOpen ? 'No hay observaciones pendientes.' : 'Sin observaciones registradas.');
        L.push('', '_' + new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · Mis Notas_');
        return L.join('\n');
    }
    async function localMedia(p) {
        var out = [], list = annotationsOf(p);
        for (var i = 0; i < list.length; i++) {
            var a = list[i].a;
            if (!a.media) continue;
            var b = await Data.getBlob(a.media.key);
            if (b) out.push({ a: a, blob: b });
        }
        return out;
    }
    function mediaName(p, a, blob) {
        return Share.safeName(p.name) + '_obs' + a.n + '_' + (TYPES[a.type] || TYPES.text).label.toLowerCase() + '.' + Data.extFor(blob.type || (a.media && a.media.mime));
    }

    async function openShareMenu(anchor, p) {
        var st = stats(p), media = await localMedia(p), size = media.reduce(function(s, m) { return s + m.blob.size; }, 0);
        var v = await UI.menu(anchor, [
            { heading: 'Resumen de observaciones' },
            { label: 'Enviar por WhatsApp', hint: st.total + (st.total === 1 ? ' observación' : ' observaciones') + ' en texto', icon: 'whatsapp', value: 'wa' },
            { label: 'Compartir en otra app', hint: 'Correo, Telegram, Teams…', icon: 'share', value: 'text' },
            { separator: true },
            { heading: 'Archivos' },
            { label: 'Compartir multimedia', hint: media.length ? media.length + ' archivos · ' + Data.formatBytes(size) : 'Sin archivos en este dispositivo', icon: 'images', value: 'media', disabled: !media.length },
            { label: 'Exportar proyecto (.json)', hint: 'Para otro equipo o respaldo', icon: 'braces', value: 'json' }
        ], 'Compartir «' + p.name + '»');
        if (v === 'wa') summaryDialog(p, 'whatsapp');
        else if (v === 'text') summaryDialog(p, '');
        else if (v === 'media') shareAllMedia(p, media);
        else if (v === 'json') exportJsonDialog(p);
    }

    function summaryDialog(p, target) {
        var wa = target === 'whatsapp';
        UI.open(function(dlg, close) {
            dlg.innerHTML = dialogHead(wa ? 'Enviar resumen por WhatsApp' : 'Compartir resumen') +
                '<label class="ui-check"><input type="checkbox" data-only><div><b>Solo pendientes</b><small>Omite las observaciones ya resueltas</small></div></label>' +
                '<label class="ui-field"><span>Mensaje (puedes editarlo)</span><textarea class="ui-preview" data-text spellcheck="false"></textarea></label>' +
                (wa ? '<label class="ui-field"><span>Número (opcional)</span><input data-phone type="tel" inputmode="tel" placeholder="Con código de país, ej. 52 55 1234 5678" value="' + esc(Data.ls('vx-wa-phone') || '') + '"></label>' : '') +
                '<div class="ui-actions"><button class="btn btn-ghost" data-copy>Copiar</button><button class="btn" data-send data-autofocus>' + ic(wa ? 'whatsapp' : 'share') + (wa ? 'Abrir WhatsApp' : 'Compartir') + '</button></div>';
            var q = function(s) { return dlg.querySelector(s); }, ta = q('[data-text]');
            ta.value = summaryText(p, false);
            q('[data-only]').addEventListener('change', function(e) { ta.value = summaryText(p, e.target.checked); });
            q('[data-x]').addEventListener('click', close);
            q('[data-copy]').addEventListener('click', function() {
                (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(function() { UI.toast('Resumen copiado'); }, function() { ta.select(); document.execCommand('copy'); UI.toast('Resumen copiado'); });
            });
            q('[data-send]').addEventListener('click', function() {
                var phone = wa ? q('[data-phone]').value.trim() : '';
                if (wa) Data.ls('vx-wa-phone', phone || null);
                close();
                Share.text(ta.value, { target: target, phone: phone, title: p.name });
            });
        }, null, 'ui-dialog-wide');
    }

    async function shareAllMedia(p, media) {
        media = media || await localMedia(p);
        var target = await UI.choice('Compartir multimedia', [
            { label: 'Enviar por WhatsApp', hint: media.length + (media.length === 1 ? ' archivo' : ' archivos'), icon: 'whatsapp', value: 'whatsapp', primary: true },
            { label: 'Elegir otra app', hint: 'Telegram, correo, Drive, redes sociales…', icon: 'share', value: 'other' }
        ], 'Los archivos se envían desde este dispositivo.');
        if (!target) return;
        var files = media.map(function(m) { return { blob: m.blob, mime: m.blob.type || m.a.media.mime, name: mediaName(p, m.a, m.blob) }; });
        Share.files(files, { text: 'Multimedia de «' + p.name + '»', title: p.name, target: target === 'whatsapp' ? 'whatsapp' : '' });
    }

    async function exportJsonDialog(p) {
        var pdf = await Data.getPdf(p.id), media = await localMedia(p), st = stats(p);
        var size = media.reduce(function(s, m) { return s + m.blob.size; }, 0);
        UI.open(function(dlg, close) {
            dlg.innerHTML = dialogHead('Exportar proyecto') +
                '<p>Crea un archivo .json para abrir el proyecto en otro dispositivo, enviarlo o guardarlo como respaldo.</p>' +
                '<div style="margin-top:6px">' +
                '<label class="ui-check"><input type="checkbox" checked disabled><div><b>Observaciones y estados</b><small>' + st.total + ' observaciones · siempre incluidas</small></div></label>' +
                '<label class="ui-check"><input type="checkbox" data-pdf' + (pdf ? '' : ' disabled') + '><div><b>Documento PDF</b><small>' + (pdf ? Data.formatBytes(pdf.size) : 'No está en este dispositivo') + '</small></div></label>' +
                '<label class="ui-check"><input type="checkbox" data-media' + (media.length ? '' : ' disabled') + '><div><b>Fotos, videos y audios</b><small>' + (media.length ? media.length + ' archivos · ' + Data.formatBytes(size) + ' (el archivo pesará más)' : 'No hay multimedia en este dispositivo') + '</small></div></label>' +
                '</div><div class="ui-actions"><button class="btn btn-ghost" data-dl>' + ic('download') + 'Descargar</button><button class="btn" data-share>' + ic('share') + 'Compartir</button></div>';
            var q = function(s) { return dlg.querySelector(s); };
            var name = Share.safeName(p.name) + '_' + new Date().toISOString().slice(0, 10) + '.json';
            function build() { return Share.projectJSON(p, { includePdf: q('[data-pdf]').checked, includeMedia: q('[data-media]').checked }); }
            q('[data-x]').addEventListener('click', close);
            q('[data-dl]').addEventListener('click', async function(e) { e.currentTarget.classList.add('is-busy'); var b = await build(); close(); Share.save(b, name, 'application/json'); });
            q('[data-share]').addEventListener('click', async function(e) {
                e.currentTarget.classList.add('is-busy');
                var b = await build(); close();
                Share.files([{ blob: b, name: name, mime: 'application/json' }], { title: p.name, text: 'Proyecto de validación «' + p.name + '» (ábrelo con Mis Notas → Importar)' });
            });
        }, null, 'ui-dialog-form');
    }

    // ================= EDITOR =================
    async function openProject(id) {
        var p = byId(id);
        if (!p) return;
        current = p; selectedId = null; page = 1; pdfDoc = null; autoFit = true; pendingPoint = null;
        pf = { status: 'all', type: 'all' };
        setTool('select');
        $('vx-dashboard').classList.add('hidden');
        $('vx-editor').classList.remove('hidden');
        document.body.classList.add('editor-open');
        $('vx-title').value = p.name;
        renderDocline();
        $('vx-pages').textContent = (p.pdf && p.pdf.pages) || '–';
        $('vx-page').value = 1;
        $('annotation-layer').innerHTML = '';
        $('pdf-text-layer').innerHTML = '';
        $('vx-stage').scrollTop = 0;
        setPanel(isWide() ? Data.ls('vx-panel-wide') !== '0' : false);
        showList();
        refreshCount();
        await loadDocument();
    }

    function closeEditor() {
        persist(true);
        hideSelChip();
        setTool('select');
        loadToken++;
        current = null; pdfDoc = null; selectedId = null;
        Object.keys(urlCache).forEach(revoke);
        $('vx-editor').classList.add('hidden');
        $('vx-dashboard').classList.remove('hidden');
        document.body.classList.remove('editor-open');
        renderDashboard();
    }

    function renderDocline() {
        if (!current) return;
        var p = current, t;
        if (!p.pdf) t = 'Sin documento';
        else {
            var where = !localPdfs[p.id] ? (pdfInCloud(p) ? ' · en la nube' : ' · en otro dispositivo') : (Sync.user() ? (pdfInCloud(p) ? ' · respaldado en la nube' : ' · pendiente de subir') : '');
            t = p.pdf.name + (p.pdf.pages ? ' · ' + p.pdf.pages + ' págs.' : '') + where;
        }
        $('vx-docline').textContent = t;
    }

    function refreshCount() {
        if (!current) return;
        var s = stats(current), em = $('vx-open-count');
        em.textContent = s.total ? s.open : '0';
        em.classList.toggle('is-zero', !s.open);
        em.title = s.open + ' pendientes de ' + s.total;
    }

    async function loadDocument() {
        var token = ++loadToken, p = current;
        var blob = await Data.getPdf(p.id);
        if (token !== loadToken) return;
        if (!blob && pdfInCloud(p)) {
            if (!Sync.user()) { pdfDoc = null; showNoDoc('signed-out'); return; }
            if (!ownPath(p.pdf.remotePath)) { pdfDoc = null; showNoDoc(); return; }
            showNoDoc('downloading');
            try {
                blob = await downloadPdf(p, function(f, got, total) {
                    var bar = document.querySelector('#vx-nodoc .vx-bar i'), txt = document.querySelector('#vx-nodoc [data-dlp]');
                    if (bar) bar.style.width = Math.round(f * 100) + '%';
                    if (txt) txt.textContent = Data.formatBytes(got) + ' de ' + Data.formatBytes(total);
                });
            } catch (e) {
                if (token !== loadToken) return;
                pdfDoc = null;
                showNoDoc(e.offline ? 'offline' : 'cloud-error', e.message);
                return;
            }
            if (token !== loadToken) return;
            renderDocline();
        }
        if (!blob) { pdfDoc = null; showNoDoc(); return; }
        $('vx-nodoc').classList.add('hidden');
        $('pdf-container').classList.remove('hidden');
        try {
            var buf = await blob.arrayBuffer();
            var doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
            if (token !== loadToken) return;
            pdfDoc = doc;
            if (!p.pdf) p.pdf = { name: 'documento.pdf', size: blob.size, pages: doc.numPages, hash: null };
            if (p.pdf.pages !== doc.numPages) { p.pdf.pages = doc.numPages; touch(p, { quiet: true }); }
            renderDocline();
            $('vx-pages').textContent = doc.numPages;
            await fitScale(false);
            renderPage(clamp(page, 1, doc.numPages));
            if (!selectedId) renderList();
        } catch (e) {
            console.error(e);
            pdfDoc = null;
            showNoDoc('error');
        }
    }

    function showNoDoc(kind, detail) {
        $('pdf-container').classList.add('hidden');
        $('annotation-layer').innerHTML = '';
        var n = $('vx-nodoc'), p = current, h;
        var size = p.pdf && p.pdf.size ? Data.formatBytes(p.pdf.size) : '';
        if (kind === 'downloading') {
            h = '<div class="vx-nodoc-ic">' + ic('download') + '</div><h3>Descargando el documento</h3><p>«' + esc(p.pdf.name) + '»' + (size ? ' · ' + size : '') + ' desde tu nube. Después quedará guardado en este dispositivo.</p>' +
                '<div class="vx-bar" style="margin:4px 0 8px"><i style="width:3%"></i></div><small data-dlp>Conectando…</small>';
            n.innerHTML = h; n.classList.remove('hidden');
            return;
        }
        if (kind === 'offline' || kind === 'cloud-error' || kind === 'signed-out') {
            var title = kind === 'offline' ? 'Sin conexión' : kind === 'signed-out' ? 'Inicia sesión para ver el PDF' : 'No se pudo descargar el PDF';
            var msg = kind === 'offline' ? '«' + esc(p.pdf.name) + '» está en tu nube. Conéctate a internet para descargarlo; las observaciones sí están disponibles.'
                : kind === 'signed-out' ? '«' + esc(p.pdf.name) + '» está guardado en tu nube de Supabase.'
                : esc(detail || 'Inténtalo de nuevo en un momento.');
            h = '<div class="vx-nodoc-ic">' + ic(kind === 'offline' ? 'cloudOff' : kind === 'signed-out' ? 'user' : 'cloudAlert') + '</div><h3>' + title + '</h3><p>' + msg + '</p>' +
                '<button class="vx-btn vx-btn-primary" data-retry>' + ic(kind === 'signed-out' ? 'sliders' : 'sync') + (kind === 'signed-out' ? 'Nube y cuenta' : 'Reintentar') + '</button>' +
                '<small>También puedes <button class="ui-link" data-pick>adjuntar el PDF</button> manualmente.</small>';
            n.innerHTML = h; n.classList.remove('hidden');
            n.querySelector('[data-retry]').addEventListener('click', function() { if (kind === 'signed-out') Sync.openSettings(); else loadDocument(); });
            n.querySelector('[data-pick]').addEventListener('click', function() { $('vx-file-pdf').click(); });
            return;
        }
        if (kind === 'error') {
            h = '<div class="vx-nodoc-ic">' + ic('alert') + '</div><h3>No se pudo abrir el PDF</h3><p>El archivo parece dañado o protegido. Prueba adjuntarlo de nuevo.</p><button class="vx-btn vx-btn-primary" data-pick>' + ic('upload') + 'Adjuntar PDF</button>';
        } else if (p.pdf) {
            var from = p.pdf.device ? '«' + esc(p.pdf.device) + '»' : 'otro equipo';
            h = '<div class="vx-nodoc-ic">' + ic('phone') + '</div><h3>El PDF aún no está en la nube</h3><p>«' + esc(p.pdf.name) + '» se cargó en ' + from + ' y todavía no se ha subido. Se subirá cuando ese equipo tenga internet y sesión iniciada; mientras tanto puedes adjuntar el mismo archivo aquí.</p>' +
                '<button class="vx-btn vx-btn-primary" data-pick>' + ic('upload') + 'Adjuntar PDF</button>' + (p.pdf.skipUpload ? '<small>Este PDF es demasiado grande para el plan de Supabase.</small>' : '');
        } else {
            h = '<div class="vx-nodoc-ic">' + ic('filePlus') + '</div><h3>Agrega el documento a revisar</h3><p>Selecciona el PDF de este proyecto.' + (Sync.user() ? ' Se guardará en este dispositivo y en tu nube.' : ' Se guarda en este dispositivo.') + '</p>' +
                '<button class="vx-btn vx-btn-primary" data-pick>' + ic('upload') + 'Seleccionar PDF</button>' + (isTouch() ? '' : '<small>También puedes arrastrar el archivo aquí.</small>');
        }
        n.innerHTML = h;
        n.classList.remove('hidden');
        n.querySelector('[data-pick]').addEventListener('click', function() { $('vx-file-pdf').click(); });
    }

    async function attachPdf(p, file, silent) {
        if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { UI.toast('Selecciona un archivo PDF', 'error'); return false; }
        var blob = await toBlob(file, 'application/pdf');
        var hash = await Data.sha256(blob);
        if (!silent && p.pdf && p.pdf.hash && hash && hash !== p.pdf.hash) {
            var ok = await UI.confirm('Este PDF es distinto al que se usó originalmente («' + p.pdf.name + '»). Las marcas podrían no coincidir con el texto.', { title: 'El documento no coincide', okText: 'Usar este PDF' });
            if (!ok) return false;
        }
        await Data.putPdf(p.id, blob);
        localPdfs[p.id] = true;
        var prev = p.pdf || {};
        p.pdf = {
            name: file.name || 'documento.pdf', size: blob.size, pages: prev.hash && prev.hash === hash ? prev.pages : null,
            hash: hash, ver: hash || Data.uid('v'), device: Data.device().name,
            remotePath: prev.remotePath || null, remoteHash: prev.remoteHash || null
        };
        touch(p, { quiet: true });
        return true;
    }

    // ---------- Render del PDF ----------
    function fitScale(widthOnly) {
        if (!pdfDoc) return Promise.resolve();
        return pdfDoc.getPage(page).then(function(pg) {
            var st = $('vx-stage'), cs = getComputedStyle(st);
            var w = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4;
            var h = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4;
            var vp = pg.getViewport({ scale: 1 });
            var sx = w / vp.width, sy = h / vp.height;
            pdfScale = clamp((widthOnly || st.clientWidth < 700) ? sx : Math.min(sx, sy), 0.25, 3);
            updateZoomLabel();
        });
    }

    function renderPage(num, keepScroll) {
        if (!pdfDoc) return;
        if (rendering) { pendingRender = { num: num, keepScroll: keepScroll }; return; }
        rendering = true;
        var stage = $('vx-stage'), ratio = pdfScale / renderedScale;
        var prevLeft = stage.scrollLeft * ratio, prevTop = stage.scrollTop * ratio;
        var samePage = num === page && $('annotation-layer').childElementCount > 0;
        pdfDoc.getPage(num).then(function(pg) {
            var scale = pdfScale, vp = pg.getViewport({ scale: scale });
            var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
            var off = document.createElement('canvas');
            off.width = Math.floor(vp.width * dpr); off.height = Math.floor(vp.height * dpr);
            return pg.render({ canvasContext: off.getContext('2d'), transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, viewport: vp }).promise.then(function() {
                var canvas = $('pdf-canvas'), c = $('pdf-container');
                canvas.width = off.width; canvas.height = off.height;
                canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
                canvas.getContext('2d').drawImage(off, 0, 0);
                c.style.width = Math.floor(vp.width) + 'px'; c.style.height = Math.floor(vp.height) + 'px';
                c.style.transform = '';
                renderedScale = scale;
                return pg.getTextContent();
            }).then(function(tc) {
                var tl = $('pdf-text-layer');
                tl.innerHTML = '';
                pdfjsLib.renderTextLayer({ textContent: tc, container: tl, viewport: vp, textDivs: [], enhanceTextSelection: true });
                page = num;
                $('vx-page').value = num;
                $('vx-prev').disabled = num <= 1;
                $('vx-next').disabled = num >= pdfDoc.numPages;
                if (!(keepScroll && samePage)) renderPins();
                if (keepScroll) { stage.scrollLeft = prevLeft; stage.scrollTop = prevTop; }
                else stage.scrollTop = 0;
            });
        }).catch(function(e) { console.error(e); }).then(function() {
            rendering = false;
            if (pendingRender) { var r = pendingRender; pendingRender = null; renderPage(r.num, r.keepScroll); }
        });
    }

    function goToPage(n) {
        if (!pdfDoc) return;
        n = clamp(parseInt(n, 10) || page, 1, pdfDoc.numPages);
        if (n !== page) renderPage(n);
        else $('vx-page').value = n;
    }

    function updateZoomLabel(temp) { $('vx-zoom-level').textContent = Math.round((temp || pdfScale) * 100) + '%'; }
    function previewZoom(s) { var c = $('pdf-container'); c.style.transformOrigin = '0 0'; c.style.transform = 'scale(' + (s / renderedScale) + ')'; }
    function scheduleRender() {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(function() {
            if (pdfDoc && Math.abs(pdfScale - renderedScale) > 0.005) renderPage(page, true);
            else $('pdf-container').style.transform = '';
        }, 320);
    }
    function setZoom(s) {
        if (!pdfDoc) return;
        autoFit = false;
        pdfScale = clamp(s, 0.25, 4);
        updateZoomLabel();
        previewZoom(pdfScale);
        scheduleRender();
    }
    function fitNow(widthOnly) { if (!pdfDoc) return; autoFit = !widthOnly; fitScale(widthOnly).then(function() { renderPage(page); }); }

    // ---------- Marcadores sobre el documento ----------
    function renderPins() {
        var layer = $('annotation-layer');
        if (!current || !pdfDoc) { layer.innerHTML = ''; return; }
        var html = '';
        (current.annotations[page] || []).forEach(function(a) {
            var cls = (a.id === selectedId ? ' is-selected' : '') + (a.status === 'done' ? ' is-done' : '');
            if (a.type === 'replacement' && a.rects) {
                a.rects.forEach(function(r) { html += '<div class="vx-strike' + cls + '" data-for="' + a.id + '" style="left:' + r.x + '%;top:' + (r.y + r.h / 2) + '%;width:' + r.w + '%"></div>'; });
            }
            html += '<button class="vx-pin t-' + a.type + cls + '" data-id="' + a.id + '" style="left:' + a.x + '%;top:' + a.y + '%" title="#' + a.n + ' · ' + (TYPES[a.type] || TYPES.text).label + '" aria-label="Observación ' + a.n + '">' + (a.status === 'done' ? ic('check') : a.n) + '</button>';
        });
        layer.innerHTML = html;
        layer.querySelectorAll('.vx-pin').forEach(bindPin);
    }
    function markSelected() {
        document.querySelectorAll('#annotation-layer [data-id], #annotation-layer [data-for]').forEach(function(el) {
            el.classList.toggle('is-selected', (el.getAttribute('data-id') || el.getAttribute('data-for')) === selectedId);
        });
    }

    function bindPin(el) {
        var f = findAnn(el.getAttribute('data-id'));
        if (!f) return;
        var a = f.a, start = null, moved = false;
        el.addEventListener('pointerdown', function(e) {
            if (tool !== 'select' || e.button > 0) return;
            e.stopPropagation();
            var cr = $('pdf-container').getBoundingClientRect();
            start = { x: e.clientX, y: e.clientY, ax: a.x, ay: a.y, w: cr.width, h: cr.height };
            moved = false;
            try { el.setPointerCapture(e.pointerId); } catch (err) {}
        });
        el.addEventListener('pointermove', function(e) {
            if (!start) return;
            var dx = e.clientX - start.x, dy = e.clientY - start.y;
            if (!moved && Math.hypot(dx, dy) < 6) return;
            moved = true;
            el.classList.add('is-dragging');
            a.x = clamp(start.ax + dx / start.w * 100, 0, 100);
            a.y = clamp(start.ay + dy / start.h * 100, 0, 100);
            el.style.left = a.x + '%'; el.style.top = a.y + '%';
        });
        el.addEventListener('pointerup', function() {
            if (!start) return;
            start = null;
            el.classList.remove('is-dragging');
            if (moved) { a.updatedAt = Date.now(); touch(current, { quiet: true }); }
            else select(a.id);
        });
        el.addEventListener('pointercancel', function() { start = null; el.classList.remove('is-dragging'); });
        el.addEventListener('click', function(e) { e.stopPropagation(); if (e.detail === 0) select(a.id); });
    }

    function revealPin(id) {
        var el = document.querySelector('#annotation-layer .vx-pin[data-id="' + id + '"]');
        if (!el) return;
        var st = $('vx-stage'), sr = st.getBoundingClientRect(), r = el.getBoundingClientRect();
        var visibleH = (!isWide() && panelOpen && window.innerWidth < 768) ? sr.height * 0.36 : sr.height;
        if (r.top < sr.top + 24 || r.bottom > sr.top + visibleH - 24) st.scrollTop += r.top - sr.top - visibleH * 0.35;
        if (r.left < sr.left + 12 || r.right > sr.right - 12) st.scrollLeft += r.left - sr.left - sr.width / 2;
    }

    // ---------- Herramientas ----------
    function renderTools() {
        $('vx-tools').innerHTML = TOOLS.map(function(t) {
            if (t === 'sep') return '<span class="vx-tool-sep" aria-hidden="true"></span>';
            return '<button class="vx-tool" data-tool="' + t.id + '" title="' + t.label + ' (' + t.key.toUpperCase() + ')">' + ic(t.icon) + '<span>' + t.label + '</span></button>';
        }).join('');
        $('vx-tools').querySelectorAll('[data-tool]').forEach(function(b) {
            b.addEventListener('mousedown', function(e) { if (b.getAttribute('data-tool') === 'replacement') e.preventDefault(); });
            b.addEventListener('click', function() { onTool(b.getAttribute('data-tool')); });
        });
    }
    function onTool(id) {
        if (!current) return;
        if (id !== 'select' && !pdfDoc) { UI.toast('Primero agrega el PDF del proyecto', 'info'); return; }
        if (id === 'replacement' && replaceFromSelection()) return;
        setTool(tool === id ? 'select' : id);
    }
    function setTool(id) {
        tool = id;
        document.querySelectorAll('.vx-tool').forEach(function(b) { b.classList.toggle('is-on', b.getAttribute('data-tool') === id); });
        $('vx-stage').classList.toggle('is-placing', id !== 'select' && id !== 'replacement');
        var t = TOOLS.find(function(x) { return x.id === id; }), hint = $('vx-hint');
        if (!t || id === 'select') { hint.classList.add('hidden'); return; }
        hint.innerHTML = ic(t.icon) + '<span>' + t.hint + '</span><button data-cancel>Cancelar</button>';
        hint.querySelector('[data-cancel]').addEventListener('click', function() { setTool('select'); });
        hint.classList.remove('hidden');
        if (!isWide() && panelOpen) setPanel(false);
    }

    async function placeAt(kind, x, y) {
        setTool('select');
        pendingPoint = { x: x, y: y, page: page };
        if (kind === 'text') { createAnnotation({ type: 'text', x: x, y: y }, { focus: true }); return; }
        if (kind === 'audio') return recordAudio();
        if (kind === 'timer') return openStopwatch();
        if (kind === 'photo') {
            var v = await UI.choice('Agregar foto', [
                { label: 'Tomar foto', hint: 'Abrir la cámara', icon: 'camera', value: 'cam', primary: true },
                { label: 'Elegir de la galería', hint: 'Foto o video guardado', icon: 'images', value: 'gal' }
            ]);
            if (v === 'cam') $('vx-file-photo').click(); else if (v === 'gal') $('vx-file-gallery').click(); else pendingPoint = null;
        }
        if (kind === 'video') {
            var v2 = await UI.choice('Agregar video', [
                { label: 'Grabar video', hint: isTouch() ? 'Abrir la cámara' : 'Con la cámara del equipo', icon: 'video', value: 'rec', primary: true },
                { label: 'Elegir de la galería', hint: 'Video guardado', icon: 'images', value: 'gal' }
            ]);
            if (v2 === 'rec') { if (isTouch()) $('vx-file-video').click(); else recordVideo(); }
            else if (v2 === 'gal') $('vx-file-gallery').click();
            else pendingPoint = null;
        }
    }

    function createAnnotation(data, opts) {
        opts = opts || {};
        var pg = (pendingPoint && pendingPoint.page) || page, now = Date.now();
        pendingPoint = null;
        current.seq = (current.seq || 0) + 1;
        var a = Object.assign({ id: Data.uid('a'), n: current.seq, status: 'open', text: '', createdAt: now, updatedAt: now, by: Data.device().name }, data);
        (current.annotations[pg] = current.annotations[pg] || []).push(a);
        touch(current, { quiet: true });
        if (pg === page) renderPins();
        select(a.id, { focus: opts.focus });
        return a;
    }

    async function compressImage(file) {
        try {
            if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1200000 || !window.createImageBitmap) return toBlob(file);
            var bmp = await createImageBitmap(file);
            var s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
            var c = document.createElement('canvas');
            c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            var out = await new Promise(function(r) { c.toBlob(r, 'image/jpeg', 0.86); });
            return out && out.size < file.size ? out : toBlob(file);
        } catch (e) { return toBlob(file); }
    }

    async function addMediaAnnotation(kind, blob, name) {
        if (!current) return;
        var saving = blob.size > 4e6 ? setTimeout(function() { UI.toast('Guardando archivo…', 'info'); }, 300) : null;
        blob = kind === 'photo' ? await compressImage(blob) : (blob instanceof File ? await toBlob(blob) : blob);
        var key = Data.uid('m');
        await Data.putBlob(key, blob);
        clearTimeout(saving);
        var pt = pendingPoint || { x: 45, y: 40, page: page };
        pendingPoint = pt;
        createAnnotation({ type: kind, x: pt.x, y: pt.y, media: { key: key, mime: blob.type, size: blob.size, name: name || '', device: Data.device(), capturedAt: Date.now() } });
    }
    function onMediaFile(e) {
        var f = e.target.files[0];
        e.target.value = '';
        if (!f || !current) return;
        var kind = /^video\//.test(f.type) ? 'video' : /^audio\//.test(f.type) ? 'audio' : 'photo';
        addMediaAnnotation(kind, f, f.name);
    }

    // ---------- Reemplazo de texto seleccionado ----------
    function mergeRects(rs) {
        rs.sort(function(a, b) { return a.y - b.y || a.x - b.x; });
        var out = [];
        rs.forEach(function(r) {
            var last = out[out.length - 1];
            if (last && Math.abs(last.y - r.y) < Math.max(last.h, r.h) * 0.5 && r.x <= last.x + last.w + 0.8) {
                var right = Math.max(last.x + last.w, r.x + r.w);
                last.x = Math.min(last.x, r.x); last.w = right - last.x; last.h = Math.max(last.h, r.h);
            } else out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
        });
        return out;
    }
    function selectionInfo() {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount || !pdfDoc) return null;
        var text = sel.toString().replace(/\s+/g, ' ').trim();
        if (!text) return null;
        var range = sel.getRangeAt(0);
        if (!$('pdf-text-layer').contains(range.commonAncestorContainer)) return null;
        var cr = $('pdf-container').getBoundingClientRect(), rects = [], all = range.getClientRects();
        Array.prototype.forEach.call(all, function(r) {
            if (r.width < 1 || r.height < 1) return;
            var x = Math.max(r.left, cr.left), right = Math.min(r.right, cr.right);
            if (right <= x) return;
            rects.push({ x: (x - cr.left) / cr.width * 100, y: (r.top - cr.top) / cr.height * 100, w: (right - x) / cr.width * 100, h: r.height / cr.height * 100 });
        });
        rects = mergeRects(rects);
        if (!rects.length) return null;
        return { text: text, rects: rects, sel: sel, last: all[all.length - 1] };
    }
    function replaceFromSelection() {
        var info = selectionInfo();
        if (!info) return false;
        info.sel.removeAllRanges();
        hideSelChip();
        setTool('select');
        var r0 = info.rects[0];
        pendingPoint = null;
        createAnnotation({ type: 'replacement', x: r0.x, y: r0.y, rects: info.rects, originalText: info.text.slice(0, 600) }, { focus: true });
        return true;
    }
    function updateSelChip() {
        if (!current || !isEditorOpen()) return hideSelChip();
        var info = selectionInfo();
        if (!info) return hideSelChip();
        var chip = $('vx-selchip'), r = info.last;
        chip.classList.remove('hidden');
        var cw = chip.offsetWidth, chh = chip.offsetHeight;
        var top = r.bottom + (isTouch() ? 46 : 10);
        if (top + chh > window.innerHeight - 70) top = Math.max(8, r.top - chh - (isTouch() ? 54 : 10));
        chip.style.left = clamp(r.right - cw, 8, window.innerWidth - cw - 8) + 'px';
        chip.style.top = top + 'px';
    }
    function hideSelChip() { $('vx-selchip').classList.add('hidden'); }

    // ---------- Panel: lista de observaciones ----------
    function setPanel(open) {
        panelOpen = open;
        $('vx-work').classList.toggle('panel-open', open);
        $('vx-panel-btn').setAttribute('aria-pressed', open ? 'true' : 'false');
        if (isWide() && current) Data.ls('vx-panel-wide', open ? '1' : '0');
        if (open && selectedId === null) renderList();
    }
    function showList() {
        $('vx-panel-detail').classList.add('hidden');
        $('vx-panel-list').classList.remove('hidden');
        renderList();
    }
    function deselect() { selectedId = null; markSelected(); showList(); }

    function itemHtml(x) {
        var a = x.a, t = TYPES[a.type] || TYPES.text, txt;
        if (a.type === 'replacement') txt = '<del>' + esc(trunc(a.originalText, 70)) + '</del><span class="vx-arrow">→</span>' + (a.text ? esc(trunc(a.text, 80)) : '<span class="vx-muted">sin reemplazo</span>');
        else if (a.type === 'timer') txt = '<b style="font-family:var(--mono);font-weight:600">' + esc(a.time || '') + '</b>' + (a.text ? ' · ' + esc(trunc(a.text, 90)) : '');
        else txt = a.text ? esc(trunc(a.text, 140)) : '';
        var empty = !txt;
        var thumb = a.type === 'photo' && a.media ? '<img class="vx-thumb" alt="" data-thumb="' + a.media.key + '" hidden>' : '';
        return '<div class="vx-item t-' + a.type + (a.status === 'done' ? ' is-done' : '') + (a.id === selectedId ? ' is-active' : '') + '" data-id="' + a.id + '" role="button" tabindex="0">' +
            '<span class="vx-mark">' + a.n + '</span>' +
            '<div class="vx-item-body"><div class="vx-item-top"><b>' + t.label + '</b><span>·</span><span>' + Sync.relTime(a.updatedAt || a.createdAt) + '</span></div>' +
            '<div class="vx-item-text' + (empty ? ' is-empty' : '') + '">' + (empty ? 'Sin descripción' : txt) + '</div></div>' +
            '<div class="vx-item-side">' + thumb + '<button class="vx-check" data-toggle title="' + (a.status === 'done' ? 'Marcar como pendiente' : 'Marcar como resuelta') + '" aria-label="Cambiar estado">' + ic(a.status === 'done' ? 'checkCircle' : 'circle') + '</button></div></div>';
    }

    function renderList() {
        var box = $('vx-panel-list');
        if (!current) return;
        var all = annotationsOf(current), s = stats(current), counts = {};
        all.forEach(function(x) { counts[x.a.type] = (counts[x.a.type] || 0) + 1; });
        if (pf.type !== 'all' && !counts[pf.type]) pf.type = 'all';
        var list = all.filter(function(x) {
            if (pf.status === 'open' && x.a.status === 'done') return false;
            if (pf.status === 'done' && x.a.status !== 'done') return false;
            return pf.type === 'all' || x.a.type === pf.type;
        });
        var h = '<div class="vx-plist-head"><div class="vx-plist-title"><h2>Observaciones<small>' + s.total + '</small></h2>' +
            '<button class="vx-btn vx-btn-icon vx-close-panel" data-close title="Cerrar panel" aria-label="Cerrar panel">' + ic('close') + '</button></div>' +
            '<div class="vx-seg" role="tablist">' +
            '<button data-sf="all" class="' + (pf.status === 'all' ? 'is-on' : '') + '">Todas <small>' + s.total + '</small></button>' +
            '<button data-sf="open" class="' + (pf.status === 'open' ? 'is-on' : '') + '">Pendientes <small>' + s.open + '</small></button>' +
            '<button data-sf="done" class="' + (pf.status === 'done' ? 'is-on' : '') + '">Resueltas <small>' + s.done + '</small></button></div>';
        var types = TYPE_ORDER.filter(function(t) { return counts[t]; });
        if (types.length > 1) {
            h += '<div class="vx-typefilter"><button data-type="all" class="' + (pf.type === 'all' ? 'is-on' : '') + '">Todos</button>' +
                types.map(function(t) { return '<button data-type="' + t + '" class="t-' + t + (pf.type === t ? ' is-on' : '') + '" title="' + TYPES[t].label + ' (' + counts[t] + ')">' + ic(TYPES[t].icon) + '</button>'; }).join('') + '</div>';
        }
        h += '</div>';
        if (!all.length) {
            h += '<div class="vx-plist-empty">' + ic('marker') + '<p><b>Aún no hay observaciones</b></p><p>' + (pdfDoc ? 'Elige una herramienta y toca el documento, o selecciona texto para tacharlo.' : current.pdf ? 'Cuando el PDF esté disponible podrás marcar sobre él.' : 'Agrega el PDF para empezar a marcar.') + '</p></div>';
        } else if (!list.length) {
            h += '<div class="vx-plist-empty">' + ic('search') + '<p>Nada con este filtro.</p></div>';
        } else {
            var lastPage = null;
            list.forEach(function(x) {
                if (x.page !== lastPage) {
                    lastPage = x.page;
                    var n = list.filter(function(y) { return y.page === x.page; }).length;
                    h += '<div class="vx-group-title"><button data-goto="' + x.page + '">Página ' + x.page + '</button><span>' + n + '</span></div>';
                }
                h += itemHtml(x);
            });
        }
        if (s.total) {
            h += '<div class="vx-plist-foot"><div class="vx-progress"><div class="vx-progress-text"><span><b>' + s.done + '/' + s.total + '</b> resueltas</span><span>' + Math.round(s.done / s.total * 100) + '%</span></div>' +
                '<div class="vx-bar"><i style="width:' + Math.round(s.done / s.total * 100) + '%"></i></div></div></div>';
        }
        var keep = box.scrollTop;
        box.innerHTML = h;
        box.scrollTop = keep;
        box.querySelector('[data-close]').addEventListener('click', function() { setPanel(false); });
        box.querySelectorAll('[data-sf]').forEach(function(b) { b.addEventListener('click', function() { pf.status = b.getAttribute('data-sf'); renderList(); }); });
        box.querySelectorAll('[data-type]').forEach(function(b) { b.addEventListener('click', function() { pf.type = b.getAttribute('data-type'); renderList(); }); });
        box.querySelectorAll('[data-goto]').forEach(function(b) { b.addEventListener('click', function() { goToPage(+b.getAttribute('data-goto')); }); });
        box.querySelectorAll('.vx-item').forEach(function(el) {
            var id = el.getAttribute('data-id');
            el.addEventListener('click', function(e) {
                if (e.target.closest('[data-toggle]')) { e.stopPropagation(); toggleStatus(findAnn(id).a); return; }
                select(id);
            });
            el.addEventListener('keydown', function(e) { if (e.key === 'Enter' && e.target === el) select(id); });
        });
        box.querySelectorAll('[data-thumb]').forEach(function(img) {
            mediaUrl(img.getAttribute('data-thumb')).then(function(u) { if (u) { img.src = u; img.hidden = false; } });
        });
    }

    function toggleStatus(a, status) {
        a.status = status || (a.status === 'done' ? 'open' : 'done');
        a.updatedAt = Date.now();
        touch(current, { quiet: true });
        renderPins();
        if ($('vx-panel-detail').classList.contains('hidden')) renderList();
    }

    // ---------- Panel: detalle de una observación ----------
    function select(id, opts) {
        opts = opts || {};
        var f = findAnn(id);
        if (!f) return;
        selectedId = id;
        if (!panelOpen) setPanel(true);
        if (f.page !== page && pdfDoc) { renderPage(f.page); setTimeout(function() { revealPin(id); }, 350); }
        else { markSelected(); setTimeout(function() { revealPin(id); }, 60); }
        showDetail(f.a, f.page, opts);
    }

    function showDetail(a, pg, opts) {
        opts = opts || {};
        $('vx-panel-list').classList.add('hidden');
        var box = $('vx-panel-detail');
        box.classList.remove('hidden');
        var t = TYPES[a.type] || TYPES.text, all = annotationsOf(current);
        var idx = all.findIndex(function(x) { return x.a.id === a.id; });
        var h = '<div class="vx-detail-head"><button class="vx-btn vx-back-list" data-list>' + ic('chevronLeft') + 'Todas</button><span class="vx-grow"></span>' +
            '<button class="vx-btn vx-btn-icon" data-prev title="Anterior"' + (idx <= 0 ? ' disabled' : '') + '>' + ic('chevronLeft') + '</button>' +
            '<span class="vx-muted" style="font-family:var(--mono);font-size:12px;padding:0 2px">' + (idx + 1) + '/' + all.length + '</span>' +
            '<button class="vx-btn vx-btn-icon" data-next title="Siguiente"' + (idx >= all.length - 1 ? ' disabled' : '') + '>' + ic('chevronRight') + '</button>' +
            '<button class="vx-btn vx-btn-icon vx-close-panel" data-close title="Cerrar panel">' + ic('close') + '</button></div>';
        h += '<div class="vx-detail t-' + a.type + '">';
        h += '<div class="vx-detail-title"><span class="vx-type">' + ic(t.icon) + t.label + '</span><h2>#' + a.n + '</h2><span class="vx-muted">Página ' + pg + '</span></div>';
        h += '<div class="vx-status" role="radiogroup" aria-label="Estado">' +
            '<button data-status="open" role="radio" aria-checked="' + (a.status !== 'done') + '" class="' + (a.status !== 'done' ? 'is-on' : '') + '">' + ic('circle') + 'Pendiente</button>' +
            '<button data-status="done" role="radio" aria-checked="' + (a.status === 'done') + '" class="' + (a.status === 'done' ? 'is-on' : '') + '">' + ic('checkCircle') + 'Resuelta</button></div>';
        if (a.type === 'replacement') h += '<div class="vx-field"><label>Texto original</label><div class="vx-original"><del>' + esc(a.originalText) + '</del></div></div>';
        if (a.type === 'timer') {
            h += '<div class="vx-field"><label>Tiempo medido</label><div class="vx-time">' + esc(a.time || '00:00.00') + '</div>' +
                (a.laps && a.laps.length ? '<div class="vx-laps" style="margin-top:8px">' + a.laps.map(function(l, i) { return '<div><span>Vuelta ' + (i + 1) + '</span><span>' + esc(l) + '</span></div>'; }).join('') + '</div>' : '') + '</div>';
        }
        if (a.media) h += '<div class="vx-field"><label>' + t.label + '</label><div data-media></div></div>';
        h += '<div class="vx-field"><label for="vx-ann-text">' + t.field + '</label><textarea id="vx-ann-text" placeholder="' + t.ph + '">' + esc(a.text) + '</textarea></div>';
        h += '<div class="vx-meta">Creada ' + fmtDate(a.createdAt) + (a.by ? ' · ' + esc(a.by) : '') + (a.updatedAt && a.updatedAt - a.createdAt > 60000 ? '<br>Modificada ' + fmtDate(a.updatedAt) : '') + '</div>';
        h += '<div class="vx-detail-foot"><button class="vx-btn vx-btn-danger" data-delete>' + ic('trash') + 'Eliminar</button>' +
            '<button class="vx-btn vx-btn-quiet" data-next-open>Siguiente pendiente' + ic('chevronRight') + '</button></div>';
        h += '</div>';
        box.innerHTML = h;
        box.scrollTop = 0;
        if (a.media) renderMedia(box.querySelector('[data-media]'), a);

        var q = function(s) { return box.querySelector(s); };
        q('[data-list]').addEventListener('click', deselect);
        q('[data-close]').addEventListener('click', function() { setPanel(false); });
        q('[data-prev]').addEventListener('click', function() { if (idx > 0) select(all[idx - 1].a.id); });
        q('[data-next]').addEventListener('click', function() { if (idx < all.length - 1) select(all[idx + 1].a.id); });
        box.querySelectorAll('[data-status]').forEach(function(b) {
            b.addEventListener('click', function() {
                var s = b.getAttribute('data-status');
                if (a.status === s || (s === 'open' && a.status !== 'done')) return;
                toggleStatus(a, s);
                box.querySelectorAll('[data-status]').forEach(function(x) { var on = x.getAttribute('data-status') === (a.status === 'done' ? 'done' : 'open'); x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on); });
            });
        });
        var ta = q('#vx-ann-text');
        ta.addEventListener('input', function() {
            a.text = ta.value;
            a.updatedAt = Date.now();
            clearTimeout(textTimer);
            textTimer = setTimeout(function() { touch(current, { quiet: true }); }, 350);
        });
        ta.addEventListener('blur', function() { clearTimeout(textTimer); if (current) touch(current, { quiet: true }); });
        q('[data-delete]').addEventListener('click', function() { deleteAnnotation(a); });
        q('[data-next-open]').addEventListener('click', function() {
            var rest = all.slice(idx + 1).concat(all.slice(0, idx)).filter(function(x) { return x.a.status !== 'done'; });
            if (rest.length) select(rest[0].a.id); else UI.toast('No hay más observaciones pendientes');
        });
        if (opts.focus) setTimeout(function() { ta.focus(); }, isTouch() ? 280 : 30);
    }

    async function renderMedia(el, a) {
        var m = a.media, url = await mediaUrl(m.key);
        if (!el.isConnected) return;
        if (!url) {
            var mine = m.device && m.device.id === Data.device().id;
            el.innerHTML = '<div class="vx-media-missing">' + ic('phone') + '<div><b>' + (mine ? 'Archivo no encontrado' : 'Guardado en otro dispositivo') + '</b>' +
                (mine ? 'El archivo ya no está en este equipo.' : 'Se capturó en «' + esc(m.device ? m.device.name : 'otro equipo') + '». Por su peso, la multimedia se queda en el equipo donde se tomó; compártela desde ahí.') + '</div></div>';
            return;
        }
        var inner = a.type === 'photo' ? '<img src="' + url + '" alt="Foto de la observación #' + a.n + '">'
            : a.type === 'video' ? '<video src="' + url + '" controls playsinline preload="metadata"></video>'
            : '<audio src="' + url + '" controls preload="metadata"></audio>';
        el.innerHTML = '<div class="vx-media' + (a.type === 'audio' ? ' is-audio' : '') + '">' + inner + '</div>' +
            '<div class="vx-media-meta"><span>' + ic('phone') + esc(m.device ? m.device.name : 'Este dispositivo') + '</span><span>' + Data.formatBytes(m.size) + '</span>' + (m.capturedAt ? '<span>' + fmtDate(m.capturedAt) + '</span>' : '') + '</div>' +
            '<div class="vx-media-actions"><button class="vx-btn vx-btn-quiet vx-btn-wa" data-wa>' + ic('whatsapp') + 'WhatsApp</button>' +
            '<button class="vx-btn vx-btn-quiet" data-share>' + ic('share') + 'Compartir</button>' +
            '<button class="vx-btn vx-btn-quiet vx-btn-icon" data-dl title="Guardar en el dispositivo" aria-label="Descargar">' + ic('download') + '</button></div>';
        var img = el.querySelector('img');
        if (img) img.addEventListener('click', function() { openFullscreenImage(url); });
        el.querySelector('[data-wa]').addEventListener('click', function() { shareMedia(a, 'whatsapp'); });
        el.querySelector('[data-share]').addEventListener('click', function() { shareMedia(a, ''); });
        el.querySelector('[data-dl]').addEventListener('click', async function() {
            var b = await Data.getBlob(m.key);
            if (b) Share.save(b, mediaName(current, a, b), b.type);
        });
    }

    async function shareMedia(a, target) {
        var b = await Data.getBlob(a.media.key);
        if (!b) return;
        var caption = '#' + a.n + ' ' + (TYPES[a.type] || TYPES.text).label + ' · ' + current.name + (a.text ? '\n' + a.text : '');
        Share.files([{ blob: b, mime: b.type || a.media.mime, name: mediaName(current, a, b) }], { text: caption, title: current.name, target: target });
    }

    async function deleteAnnotation(a) {
        var ok = await UI.confirm('Se eliminará la observación #' + a.n + (a.media ? ' y su archivo guardado en este dispositivo' : '') + '.', { title: 'Eliminar observación', okText: 'Eliminar', danger: true });
        if (!ok) return;
        var f = findAnn(a.id);
        if (!f) return;
        current.annotations[f.page].splice(f.index, 1);
        if (!current.annotations[f.page].length) delete current.annotations[f.page];
        if (a.media) { Data.delBlob(a.media.key); revoke(a.media.key); }
        selectedId = null;
        touch(current, { quiet: true });
        renderPins();
        showList();
        UI.toast('Observación eliminada');
    }

    // ---------- Grabaciones ----------
    function fmtClock(ms, cents) {
        var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
        var out = (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(ss).padStart(2, '0');
        return cents ? out + '.' + String(Math.floor((ms % 1000) / 10)).padStart(2, '0') : out;
    }

    async function recordAudio() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { pendingPoint = null; return UI.toast('Este dispositivo no permite grabar audio', 'error'); }
        var stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch (e) { pendingPoint = null; return UI.toast('Permite el acceso al micrófono para grabar', 'error'); }
        var mime = pickMime(['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']);
        var rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        var chunks = [], keep = false, t0 = Date.now(), timer, raf, actx;
        rec.ondataavailable = function(e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function() {
            clearInterval(timer); cancelAnimationFrame(raf);
            stream.getTracks().forEach(function(t) { t.stop(); });
            if (actx) actx.close().catch(function() {});
            if (keep && chunks.length) addMediaAnnotation('audio', new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] }), 'audio');
            else pendingPoint = null;
        };
        rec.start(250);
        UI.open(function(dlg, close) {
            dlg.innerHTML = dialogHead('Grabando audio') + '<div class="vx-rec"><span class="vx-rec-dot"></span><span class="vx-rec-time" data-t>00:00</span></div><div class="vx-meter"><i data-m></i></div>' +
                '<div class="ui-actions"><button class="btn btn-ghost" data-cancel>Descartar</button><button class="btn" data-save>' + ic('stop') + 'Detener y guardar</button></div>';
            var tEl = dlg.querySelector('[data-t]'), mEl = dlg.querySelector('[data-m]');
            timer = setInterval(function() { tEl.textContent = fmtClock(Date.now() - t0); }, 250);
            try {
                actx = new (window.AudioContext || window.webkitAudioContext)();
                var an = actx.createAnalyser(); an.fftSize = 512;
                actx.createMediaStreamSource(stream).connect(an);
                var data = new Uint8Array(an.fftSize);
                (function loop() {
                    an.getByteTimeDomainData(data);
                    var peak = 0; for (var i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
                    mEl.style.width = Math.min(100, peak / 128 * 220) + '%';
                    raf = requestAnimationFrame(loop);
                })();
            } catch (e) {}
            function stop(save) { keep = save; close(); if (rec.state !== 'inactive') rec.stop(); }
            dlg.querySelector('[data-x]').addEventListener('click', function() { stop(false); });
            dlg.querySelector('[data-cancel]').addEventListener('click', function() { stop(false); });
            dlg.querySelector('[data-save]').addEventListener('click', function() { stop(true); });
        }, function() { keep = false; if (rec.state !== 'inactive') rec.stop(); });
    }

    function openStopwatch() {
        var running = false, t0 = 0, acc = 0, laps = [], timer = null;
        function elapsed() { return acc + (running ? Date.now() - t0 : 0); }
        UI.open(function(dlg, close) {
            dlg.innerHTML = dialogHead('Cronómetro') + '<div class="vx-watch" data-d>00:00.00</div><div class="vx-laps" data-laps></div>' +
                '<div class="ui-actions ui-actions-split"><button class="btn btn-ghost" data-lap disabled>Vuelta</button><button class="btn" data-go>' + ic('play') + 'Iniciar</button></div>' +
                '<div class="ui-actions" style="margin-top:8px"><button class="btn btn-ghost" data-reset disabled>Reiniciar</button><button class="btn" data-save disabled>' + ic('check') + 'Guardar tiempo</button></div>';
            var q = function(s) { return dlg.querySelector(s); }, d = q('[data-d]');
            function paint() {
                d.textContent = fmtClock(elapsed(), true);
                q('[data-go]').innerHTML = running ? ic('stop') + 'Pausar' : ic('play') + (acc ? 'Continuar' : 'Iniciar');
                q('[data-lap]').disabled = !running;
                q('[data-reset]').disabled = running || !acc;
                q('[data-save]').disabled = running || !acc;
                q('[data-laps]').innerHTML = laps.map(function(l, i) { return '<div><span>Vuelta ' + (i + 1) + '</span><span>' + l + '</span></div>'; }).join('');
            }
            q('[data-go]').addEventListener('click', function() {
                if (running) { acc += Date.now() - t0; running = false; clearInterval(timer); }
                else { t0 = Date.now(); running = true; timer = setInterval(function() { d.textContent = fmtClock(elapsed(), true); }, 31); }
                paint();
            });
            q('[data-lap]').addEventListener('click', function() { laps.push(fmtClock(elapsed(), true)); paint(); });
            q('[data-reset]').addEventListener('click', function() { acc = 0; laps = []; paint(); });
            q('[data-save]').addEventListener('click', function() {
                clearInterval(timer); close();
                var pt = pendingPoint || { x: 50, y: 50 };
                createAnnotation({ type: 'timer', x: pt.x, y: pt.y, time: fmtClock(acc, true), ms: acc, laps: laps });
            });
            q('[data-x]').addEventListener('click', function() { clearInterval(timer); close(); pendingPoint = null; });
        }, function() { clearInterval(timer); pendingPoint = null; });
    }

    function recordVideo() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { $('vx-file-gallery').click(); return; }
        var modal = document.createElement('div');
        modal.className = 'video-recorder';
        modal.innerHTML = '<video autoplay muted playsinline></video><div class="recorder-bar"><button class="rec-circle" data-close aria-label="Cancelar">' + ic('close') + '</button>' +
            '<button class="rec-circle rec-main" data-rec aria-label="Grabar">' + ic('record') + '</button><span class="rec-timer" data-t>00:00</span></div>';
        document.body.appendChild(modal);
        var video = modal.querySelector('video'), btn = modal.querySelector('[data-rec]'), te = modal.querySelector('[data-t]');
        var rec = null, chunks = [], stream = null, timer = null, t0 = 0, keep = false;
        var pop = UI.pushLayer(function() { finish(false); });
        function cleanup() { pop(); clearInterval(timer); if (stream) stream.getTracks().forEach(function(t) { t.stop(); }); modal.remove(); }
        function finish(save) { keep = save; if (rec && rec.state === 'recording') rec.stop(); else { cleanup(); if (!save) pendingPoint = null; } }
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true }).then(function(s) {
            stream = s; video.srcObject = s;
            btn.addEventListener('click', function() {
                if (rec && rec.state === 'recording') { finish(true); return; }
                var mime = pickMime(['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']);
                rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
                chunks = [];
                rec.ondataavailable = function(e) { if (e.data.size) chunks.push(e.data); };
                rec.onstop = function() {
                    var type = (rec.mimeType || mime || 'video/webm').split(';')[0];
                    cleanup();
                    if (keep && chunks.length) addMediaAnnotation('video', new Blob(chunks, { type: type }), 'video');
                    else pendingPoint = null;
                };
                rec.start(500);
                t0 = Date.now();
                btn.innerHTML = ic('stop'); btn.classList.add('active');
                timer = setInterval(function() { te.textContent = fmtClock(Date.now() - t0); }, 500);
            });
            modal.querySelector('[data-close]').addEventListener('click', function() { finish(false); });
        }).catch(function() { cleanup(); pendingPoint = null; UI.toast('No hay acceso a la cámara', 'error'); });
    }

    function openFullscreenImage(src) {
        var ov = document.createElement('div');
        ov.className = 'fullscreen-overlay';
        ov.innerHTML = '<img src="' + src + '" draggable="false" alt=""><button class="fullscreen-close" aria-label="Cerrar">' + ic('close') + '</button>';
        document.body.appendChild(ov);
        var img = ov.querySelector('img'), sc = 1, px = 0, py = 0, sp = { x: 0, y: 0 }, pan = false, pd = 0, ps = 1;
        function up() { img.style.transform = 'translate(' + px + 'px,' + py + 'px) scale(' + sc + ')'; }
        ov.addEventListener('touchstart', function(e) { if (e.touches.length === 2) { pd = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); ps = sc; } else if (e.touches.length === 1 && sc > 1) { pan = true; sp.x = e.touches[0].clientX - px; sp.y = e.touches[0].clientY - py; } });
        ov.addEventListener('touchmove', function(e) { if (e.touches.length === 2 && pd > 0) { e.preventDefault(); sc = clamp(ps * Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / pd, 1, 5); up(); } else if (e.touches.length === 1 && pan) { e.preventDefault(); px = e.touches[0].clientX - sp.x; py = e.touches[0].clientY - sp.y; up(); } }, { passive: false });
        ov.addEventListener('touchend', function() { pd = 0; pan = false; });
        ov.addEventListener('wheel', function(e) { e.preventDefault(); sc = clamp(sc - e.deltaY * 0.005, 1, 5); up(); }, { passive: false });
        var pop = UI.pushLayer(close);
        function close() { pop(); ov.classList.remove('show'); setTimeout(function() { ov.remove(); }, 200); }
        ov.querySelector('.fullscreen-close').addEventListener('click', close);
        ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
        requestAnimationFrame(function() { ov.classList.add('show'); });
    }

    // ---------- Eventos ----------
    function bindStage() {
        var stage = $('vx-stage'), container = $('pdf-container');
        container.addEventListener('click', function(e) {
            if (e.target.closest('.vx-pin')) return;
            if (tool === 'select' || tool === 'replacement') return;
            var r = container.getBoundingClientRect();
            placeAt(tool, clamp((e.clientX - r.left) / r.width * 100, 0, 100), clamp((e.clientY - r.top) / r.height * 100, 0, 100));
        });
        stage.addEventListener('scroll', hideSelChip, { passive: true });

        // Pellizco con dos dedos y doble toque para ajustar
        var pinchDist = 0, pinchStart = 1, pinchScale = 1, lastTap = 0;
        stage.addEventListener('touchstart', function(e) {
            if (!pdfDoc) return;
            if (e.touches.length === 2) {
                e.preventDefault();
                pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                pinchStart = pinchScale = pdfScale;
                clearTimeout(renderTimer);
            } else if (e.touches.length === 1 && tool === 'select' && !e.target.closest('.vx-pin')) {
                var now = Date.now();
                if (now - lastTap < 280) { e.preventDefault(); fitNow(false); lastTap = 0; }
                else lastTap = now;
            }
        }, { passive: false });
        stage.addEventListener('touchmove', function(e) {
            if (e.touches.length === 2 && pinchDist > 0) {
                e.preventDefault();
                var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                pinchScale = clamp(pinchStart * d / pinchDist, 0.25, 4);
                previewZoom(pinchScale);
                updateZoomLabel(pinchScale);
            }
        }, { passive: false });
        stage.addEventListener('touchend', function(e) {
            if (pinchDist > 0 && e.touches.length < 2) { pinchDist = 0; autoFit = false; pdfScale = pinchScale; updateZoomLabel(); scheduleRender(); }
        });
        stage.addEventListener('wheel', function(e) {
            if (!pdfDoc || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            setZoom(pdfScale * (e.deltaY > 0 ? 0.9 : 1.1));
        }, { passive: false });

        // Arrastrar un PDF sobre el editor
        stage.addEventListener('dragover', function(e) { if (current && e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) e.preventDefault(); });
        stage.addEventListener('drop', async function(e) {
            var f = e.dataTransfer && e.dataTransfer.files[0];
            if (!f || !current) return;
            e.preventDefault();
            if (await attachPdf(current, f)) loadDocument();
        });
    }

    function bindDashboardDrop() {
        var view = $('vx-dashboard'), drop = $('vx-drop'), depth = 0;
        function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1; }
        view.addEventListener('dragenter', function(e) { if (!hasFiles(e)) return; depth++; drop.classList.add('is-on'); });
        view.addEventListener('dragleave', function() { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('is-on'); });
        view.addEventListener('dragover', function(e) { if (hasFiles(e)) e.preventDefault(); });
        view.addEventListener('drop', function(e) {
            depth = 0; drop.classList.remove('is-on');
            var f = e.dataTransfer && e.dataTransfer.files[0];
            if (!f) return;
            e.preventDefault();
            importFile(f);
        });
    }

    function bindStatic() {
        // Panel de proyectos
        $('vx-new').addEventListener('click', function() { newProjectDialog(); });
        $('vx-import').addEventListener('click', function() { $('vx-file-import').click(); });
        $('vx-file-import').addEventListener('change', function(e) { var f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
        $('vx-sync').addEventListener('click', Sync.openSettings);
        $('vx-sync-mini').addEventListener('click', Sync.openSettings);
        $('vx-dash-more').addEventListener('click', async function(e) {
            var v = await UI.menu(e.currentTarget, [
                { label: 'Nube y dispositivo', hint: 'Supabase, cuenta y nombre del equipo', icon: 'sliders', value: 'cloud' },
                { separator: true },
                { label: 'Crear respaldo completo', hint: 'Proyectos, PDF, multimedia y agenda (.zip)', icon: 'download', value: 'backup' },
                { label: 'Restaurar respaldo', hint: 'Desde un archivo .zip', icon: 'upload', value: 'restore' }
            ], 'Más opciones');
            if (v === 'cloud') Sync.openSettings();
            else if (v === 'backup') exportBackup();
            else if (v === 'restore') $('vx-file-import').click();
        });
        var st = null;
        $('vx-search').addEventListener('input', function(e) { clearTimeout(st); st = setTimeout(function() { dash.q = e.target.value.trim().toLowerCase(); renderDashboard(); }, 120); });
        $('vx-filter').querySelectorAll('[data-f]').forEach(function(b) {
            b.addEventListener('click', function() {
                dash.filter = b.getAttribute('data-f');
                $('vx-filter').querySelectorAll('[data-f]').forEach(function(x) { x.classList.toggle('is-on', x === b); });
                renderDashboard();
            });
        });
        $('vx-sort').addEventListener('change', function(e) { dash.sort = e.target.value; renderDashboard(); });
        bindDashboardDrop();

        // Editor
        $('vx-back').addEventListener('click', closeEditor);
        $('vx-title').addEventListener('input', function(e) {
            if (!current) return;
            current.name = e.target.value.trim() || 'Sin nombre';
            clearTimeout(textTimer);
            textTimer = setTimeout(function() { touch(current, { quiet: true }); }, 400);
        });
        $('vx-title').addEventListener('keydown', function(e) { if (e.key === 'Enter') e.target.blur(); });
        $('vx-title').addEventListener('blur', function(e) { if (current) e.target.value = current.name; });
        $('vx-prev').addEventListener('click', function() { goToPage(page - 1); });
        $('vx-next').addEventListener('click', function() { goToPage(page + 1); });
        $('vx-page').addEventListener('change', function(e) { goToPage(e.target.value); });
        $('vx-page').addEventListener('focus', function(e) { e.target.select(); });
        $('vx-zoom-in').addEventListener('click', function() { setZoom(pdfScale + 0.25); });
        $('vx-zoom-out').addEventListener('click', function() { setZoom(pdfScale - 0.25); });
        $('vx-zoom-level').addEventListener('click', function() { fitNow(false); });
        $('vx-fit').addEventListener('click', function() { fitNow(true); });
        $('vx-share').addEventListener('click', function(e) { if (current) openShareMenu(e.currentTarget, current); });
        $('vx-panel-btn').addEventListener('click', function() { setPanel(!panelOpen); });
        $('vx-scrim').addEventListener('click', function() { setPanel(false); });
        $('vx-file-pdf').addEventListener('change', async function(e) {
            var f = e.target.files[0]; e.target.value = '';
            if (f && current && await attachPdf(current, f)) loadDocument();
        });
        ['vx-file-photo', 'vx-file-video', 'vx-file-gallery'].forEach(function(id) { $(id).addEventListener('change', onMediaFile); });
        var chip = $('vx-selchip');
        chip.addEventListener('mousedown', function(e) { e.preventDefault(); });
        chip.addEventListener('click', replaceFromSelection);
        var selTimer = null;
        document.addEventListener('selectionchange', function() { clearTimeout(selTimer); selTimer = setTimeout(updateSelChip, 160); });
        bindStage();

        document.addEventListener('keydown', function(e) {
            if (!isEditorOpen() || document.querySelector('.ui-overlay, .ui-popover-layer, .video-recorder, .fullscreen-overlay')) return;
            var tag = document.activeElement && document.activeElement.tagName;
            if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
            var k = e.key.toLowerCase();
            if (e.ctrlKey || e.metaKey) {
                if (k === '+' || k === '=') { e.preventDefault(); setZoom(pdfScale + 0.25); }
                else if (k === '-') { e.preventDefault(); setZoom(pdfScale - 0.25); }
                else if (k === '0') { e.preventDefault(); fitNow(false); }
                return;
            }
            if (e.altKey) return;
            if (k === 'arrowleft' || k === 'pageup') goToPage(page - 1);
            else if (k === 'arrowright' || k === 'pagedown') goToPage(page + 1);
            else if ((k === 'delete' || k === 'backspace') && selectedId) { var f = findAnn(selectedId); if (f) deleteAnnotation(f.a); }
            else {
                var t = TOOLS.find(function(x) { return x !== 'sep' && x.key === k; });
                if (t) { e.preventDefault(); onTool(t.id); }
            }
        });

        var rt = null, wasWide = isWide();
        window.addEventListener('resize', function() {
            clearTimeout(rt);
            rt = setTimeout(function() {
                if (!current) return;
                if (isWide() !== wasWide) { wasWide = isWide(); setPanel(wasWide ? Data.ls('vx-panel-wide') !== '0' : false); }
                if (pdfDoc && autoFit) fitScale(false).then(function() { renderPage(page, true); });
            }, 220);
        });
        document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') persist(true); });
        window.addEventListener('pagehide', function() { persist(true); });
    }

    // ---------- Inicio ----------
    async function init() {
        Icons.hydrate($('section-validaciones'));
        renderTools();
        bindStatic();
        projects = await Data.loadProjects();
        await refreshLocalPdfs();
        Sync.register(adapter);
        Sync.onChange(renderSync);
        renderDashboard();
    }

    // Botón atrás de Android / Escape
    function handleBack() {
        if (!isEditorOpen()) return false;
        if (tool !== 'select') { setTool('select'); return true; }
        if (!isWide() && panelOpen) {
            if (!$('vx-panel-detail').classList.contains('hidden')) deselect();
            else setPanel(false);
            return true;
        }
        if (selectedId) { deselect(); return true; }
        closeEditor();
        return true;
    }

    return {
        init: init,
        handleBack: handleBack,
        isEditorOpen: isEditorOpen,
        getProjects: function() { return projects; },
        openProject: openProject
    };
})();
