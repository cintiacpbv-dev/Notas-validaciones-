/* Arranque de la app: navegación entre secciones, tema, respaldo y botón atrás. */
(function() {
    var $ = function(id) { return document.getElementById(id); };
    var SECTION_KEY = 'misnotas-section';

    localforage.config({ name: 'MisNotasDB', storeName: 'projects_store' });

    // ---------- Secciones ----------
    function showSection(name) {
        if (name !== 'agenda' && name !== 'validaciones') name = 'validaciones';
        $('section-validaciones').classList.toggle('hidden', name !== 'validaciones');
        $('section-agenda').classList.toggle('hidden', name !== 'agenda');
        document.body.classList.toggle('agenda-active', name === 'agenda');
        document.querySelectorAll('.nav-item[data-section]').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-section') === name);
        });
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', name === 'agenda' ? '#FF8FB1' : getComputedStyle(document.body).getPropertyValue('--card').trim() || '#ffffff');
        try { localStorage.setItem(SECTION_KEY, name); } catch (e) {}
        if (name === 'agenda') Agenda.refresh();
    }
    function currentSection() { return $('section-agenda').classList.contains('hidden') ? 'validaciones' : 'agenda'; }

    document.querySelectorAll('.nav-item[data-section]').forEach(function(b) {
        b.addEventListener('click', function() { showSection(b.getAttribute('data-section')); });
    });

    // ---------- Tema ----------
    function initTheme() {
        var themes = ['light', 'dark', 'pink'], icons = ['🌙', '🌸', '☀️'];
        var current = localStorage.getItem('sap-theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        if (themes.indexOf(current) === -1) current = 'light';
        function apply(t) {
            document.body.classList.remove('sap-dark', 'sap-pink');
            if (t === 'dark') document.body.classList.add('sap-dark');
            if (t === 'pink') document.body.classList.add('sap-pink');
            document.querySelectorAll('.js-theme-icon').forEach(function(el) { el.textContent = icons[themes.indexOf(t)]; });
            if (window.AndroidBridge && window.AndroidBridge.setDarkBars) window.AndroidBridge.setDarkBars(t === 'dark');
        }
        apply(current);
        document.querySelectorAll('.js-theme-toggle').forEach(function(b) {
            b.addEventListener('click', function() {
                current = themes[(themes.indexOf(current) + 1) % themes.length];
                localStorage.setItem('sap-theme', current);
                apply(current);
            });
        });
    }

    // ---------- Respaldo completo (proyectos + multimedia + agenda) ----------
    function progressModal(title) {
        var pm = document.createElement('div'); pm.className = 'modal-overlay';
        pm.innerHTML = '<div class="progress-modal"><h3>' + title + '</h3><div class="progress-bar"><div class="progress-bar-fill"></div></div><p>Preparando...</p></div>';
        document.body.appendChild(pm);
        return {
            set: function(pct, text) { pm.querySelector('.progress-bar-fill').style.width = pct + '%'; if (text) pm.querySelector('p').textContent = text; },
            close: function() { pm.remove(); }
        };
    }

    async function exportFullBackup() {
        var data = Validaciones.getProjects(), notes = Agenda.getNotes();
        if (!data.length && !notes.length) { UI.toast('No hay datos para exportar', 'info'); return; }
        var pm = progressModal('📦 Preparando respaldo');
        try {
            var zip = new JSZip(), total = 1, done = 0;
            data.forEach(function(p) { total++; for (var pg in p.annotations) total += p.annotations[pg].length; });
            function tick() { done++; pm.set(Math.round((done / total) * 90), done + '/' + total); }
            var cd = [];
            for (var i = 0; i < data.length; i++) {
                var p = data[i], cp = { id: p.id, name: p.name, timestamp: p.timestamp, pdfData: p.pdfData, annotations: {} };
                for (var pg in p.annotations) {
                    cp.annotations[pg] = [];
                    for (var j = 0; j < p.annotations[pg].length; j++) {
                        var ann = p.annotations[pg][j], ca = { id: ann.id, x: ann.x, y: ann.y, text: ann.text, type: ann.type };
                        if (ann.type === 'replacement') { ca.rects = ann.rects; ca.originalText = ann.originalText; }
                        if (ann.mediaKey) {
                            var blob = await Validaciones.getBlob(ann.mediaKey);
                            if (blob) {
                                var ext = ann.type === 'photo' ? '.jpg' : (ann.type === 'video' || ann.type === 'audio') ? '.webm' : '.bin';
                                zip.file('media/' + ann.mediaKey + ext, blob);
                                ca.mediaFile = 'media/' + ann.mediaKey + ext; ca.mediaType = blob.type;
                            }
                        } else if (ann.mediaUrl && ann.type === 'timer') ca.mediaUrl = ann.mediaUrl;
                        cp.annotations[pg].push(ca); tick();
                    }
                }
                cd.push(cp); tick();
            }
            zip.file('data.json', JSON.stringify(cd));
            zip.file('agenda.json', JSON.stringify(notes));
            tick();
            pm.set(95, 'Comprimiendo...');
            var zb = await zip.generateAsync({ type: 'blob' });
            pm.set(100, 'Listo');
            pm.close();
            await UI.saveFile(zb, 'MisNotas_Respaldo_' + new Date().toISOString().slice(0, 10) + '.zip', 'application/zip');
        } catch (err) { pm.close(); UI.alert(err.message, 'Error al exportar'); }
    }

    async function importFullBackup(file) {
        var pm = progressModal('📥 Importando');
        try {
            var zip = await JSZip.loadAsync(file), df = zip.file('data.json');
            if (!df) throw new Error('El archivo no es un respaldo de Mis Notas');
            var list = JSON.parse(await df.async('string'));
            if (!Array.isArray(list)) throw new Error('Respaldo inválido');
            var af = zip.file('agenda.json'), agendaList = af ? JSON.parse(await af.async('string')) : [];
            var tf = Object.keys(zip.files).length || 1, n = 0;
            for (var i = 0; i < list.length; i++) {
                var pr = list[i];
                for (var pg in pr.annotations) for (var j = 0; j < pr.annotations[pg].length; j++) {
                    var a = pr.annotations[pg][j];
                    if (!a.mediaFile) continue;
                    var ze = zip.file(a.mediaFile);
                    if (ze) {
                        var blob = await ze.async('blob');
                        if (a.mediaType) blob = new Blob([blob], { type: a.mediaType });
                        var mk = a.mediaFile.replace('media/', '').replace(/\.[^.]+$/, '');
                        await Validaciones.saveBlob(mk, blob);
                        a.mediaKey = mk; a.mediaUrl = null;
                        n++; pm.set(Math.round((n / tf) * 100), 'Archivos ' + n);
                    }
                }
            }
            pm.close();
            var mode = await UI.choice('¿Cómo quieres importar?', [
                { label: '🔀 Fusionar con lo que tengo', value: 'merge', primary: true },
                { label: '♻️ Reemplazar todo', value: 'replace', danger: true }
            ], list.length + ' proyectos y ' + agendaList.length + ' notas de agenda en el respaldo.');
            if (!mode) return;
            if (mode === 'replace' && !(await UI.confirm('Se borrarán tus datos actuales y se usarán los del respaldo.', { okText: 'Reemplazar', danger: true }))) return;
            var projects = mode === 'replace' ? list : mergeById(Validaciones.getProjects(), list, 'timestamp');
            var notes = mode === 'replace' ? agendaList : mergeById(Agenda.getNotes(), agendaList, 'updated');
            await Validaciones.setProjects(projects);
            await Agenda.setNotes(notes);
            UI.toast('✅ Importado');
        } catch (err) { pm.close(); UI.alert(err.message, 'Error al importar'); }
    }

    function mergeById(current, incoming, stampField) {
        var out = current.slice();
        incoming.forEach(function(x) {
            var i = out.findIndex(function(y) { return y.id === x.id; });
            if (i === -1) out.push(x);
            else if ((x[stampField] || 0) > (out[i][stampField] || 0)) out[i] = x;
        });
        return out;
    }

    function initBackup() {
        $('btn-export').addEventListener('click', exportFullBackup);
        $('btn-import').addEventListener('click', function() { $('file-import').click(); });
        $('file-import').addEventListener('change', function(e) { var f = e.target.files[0]; e.target.value = ''; if (f) importFullBackup(f); });
    }

    // ---------- Botón atrás (Android) y Escape (PC) ----------
    // Devuelve true si la app manejó el evento; si es false, Android cierra la app.
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
    initTheme();
    initBackup();
    Promise.all([Validaciones.init(), Agenda.init()]).then(function() {
        var saved = null;
        try { saved = localStorage.getItem(SECTION_KEY); } catch (e) {}
        showSection(saved || 'validaciones');
    });

    // Service worker solo en navegador (PWA para PC); la app Android ya trae todo offline.
    if ('serviceWorker' in navigator && !window.AndroidBridge && /^https?:$/.test(location.protocol)) {
        window.addEventListener('load', function() { navigator.serviceWorker.register('sw.js').catch(function() {}); });
    }
})();
