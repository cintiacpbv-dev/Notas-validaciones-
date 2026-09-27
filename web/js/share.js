/* Compartir y exportar: archivos por WhatsApp/redes (hoja nativa de Android o
   Web Share), resúmenes de texto, proyectos en JSON y respaldo completo en .zip. */
var Share = (function() {
    var CHUNK = 3 * 256 * 1024;

    function bridge() { return window.AndroidBridge && window.AndroidBridge.shareFiles ? window.AndroidBridge : null; }

    // Envía un archivo al lado nativo por partes y devuelve su identificador.
    async function toBridge(blob, name, mime) {
        var b = bridge();
        var id = b.beginFile(name, mime || blob.type || 'application/octet-stream');
        for (var off = 0; off < blob.size; off += CHUNK) b.appendChunk(id, await UI.blobToBase64(blob.slice(off, off + CHUNK)));
        b.endFile(id);
        return id;
    }

    // files: [{ blob, name, mime }] · opts: { text, title, target: 'whatsapp' | '' }
    async function files(list, opts) {
        opts = opts || {};
        if (!list.length) { UI.toast('No hay archivos para compartir en este dispositivo', 'info'); return false; }
        if (bridge()) {
            var ids = [];
            for (var i = 0; i < list.length; i++) ids.push(await toBridge(list[i].blob, list[i].name, list[i].mime));
            var r = bridge().shareFiles(ids.join(','), opts.text || '', opts.target || '');
            if (r === 'fallback' && opts.target === 'whatsapp') UI.toast('WhatsApp no está instalado; elige otra app', 'info');
            return true;
        }
        var fl = list.map(function(f) { return new File([f.blob], f.name, { type: f.mime || f.blob.type }); });
        if (navigator.canShare && navigator.canShare({ files: fl })) {
            try { await navigator.share({ files: fl, title: opts.title || '', text: opts.text || '' }); return true; }
            catch (e) { if (e && e.name === 'AbortError') return false; }
        }
        list.forEach(function(f, k) { setTimeout(function() { UI.downloadBlob(f.blob, f.name); }, k * 350); });
        UI.toast(opts.target === 'whatsapp' ? 'Descargado: adjúntalo en WhatsApp Web o Desktop' : 'Archivo descargado', 'info');
        return true;
    }

    function openExternal(url) {
        if (window.AndroidBridge && window.AndroidBridge.openExternal) window.AndroidBridge.openExternal(url);
        else window.open(url, '_blank', 'noopener');
    }

    // Comparte texto. target 'whatsapp' abre WhatsApp directamente (con número opcional).
    async function text(t, opts) {
        opts = opts || {};
        var phone = String(opts.phone || '').replace(/[^\d]/g, '');
        if (opts.target === 'whatsapp') {
            if (bridge() && !phone) { bridge().shareText(t, 'whatsapp'); return; }
            openExternal('https://wa.me/' + phone + '?text=' + encodeURIComponent(t));
            return;
        }
        if (bridge()) { bridge().shareText(t, ''); return; }
        if (navigator.share) {
            try { await navigator.share({ text: t, title: opts.title || '' }); return; }
            catch (e) { if (e && e.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(t); UI.toast('Resumen copiado al portapapeles'); }
        catch (e) { UI.alert(t, 'Copia el resumen'); }
    }

    // Descarga/guarda un archivo sin abrir la hoja de compartir.
    async function save(blob, name, mime) {
        if (bridge() && bridge().saveToDownloads) {
            var id = await toBridge(blob, name, mime);
            var where = bridge().saveToDownloads(id);
            if (where) UI.toast('Guardado en ' + where);
            else bridge().shareFiles(id, '', ''); // Android 9 o anterior: guardar desde la hoja de compartir
            return;
        }
        UI.downloadBlob(blob, name);
        UI.toast('Archivo descargado');
    }

    function safeName(s) {
        return String(s || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'archivo';
    }

    // ---------- Proyecto en JSON ----------
    // Devuelve un Blob JSON. opts: { includePdf, includeMedia }
    async function projectJSON(project, opts) {
        opts = opts || {};
        var clean = JSON.parse(JSON.stringify(project));
        delete clean._dirty; delete clean._syncedAt;
        var out = { format: 'misnotas.validacion', version: 2, exportedAt: new Date().toISOString(), exportedFrom: Data.device().name, project: clean };
        if (opts.includePdf) {
            var pdf = await Data.getPdf(project.id);
            if (pdf) out.pdf = { name: (project.pdf && project.pdf.name) || 'documento.pdf', data: await Data.blobToDataUrl(pdf) };
        }
        if (opts.includeMedia) {
            out.media = {};
            var anns = allAnnotations(project);
            for (var i = 0; i < anns.length; i++) {
                var m = anns[i].media;
                if (!m) continue;
                var b = await Data.getBlob(m.key);
                if (b) out.media[m.key] = await Data.blobToDataUrl(b);
            }
        }
        return new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    }

    function allAnnotations(p) {
        var out = [];
        Object.keys(p.annotations || {}).sort(function(a, b) { return a - b; }).forEach(function(pg) {
            (p.annotations[pg] || []).forEach(function(a) { out.push(a); });
        });
        return out;
    }

    // Lee un .json exportado. Devuelve [{ project, pdfBlob, media: {key: blob} }]
    async function readProjectJSON(file) {
        var txt = await file.text(), obj;
        try { obj = JSON.parse(txt); } catch (e) { throw new Error('El archivo no es un JSON válido.'); }
        var items = [];
        if (obj && obj.format === 'misnotas.validacion' && obj.project) items.push(obj);
        else if (obj && obj.format === 'misnotas.validaciones' && Array.isArray(obj.projects)) items = obj.projects;
        else if (Array.isArray(obj) && obj.length && obj[0].annotations) items = obj.map(function(p) { return { project: p }; });
        else throw new Error('El archivo no es un proyecto de Mis Notas.');
        return items.map(function(it) {
            var media = {};
            Object.keys(it.media || {}).forEach(function(k) { media[k] = Data.dataUrlToBlob(it.media[k]); });
            return { project: it.project, pdfBlob: it.pdf && it.pdf.data ? Data.dataUrlToBlob(it.pdf.data) : null, pdfName: it.pdf && it.pdf.name, media: media };
        });
    }

    // ---------- Respaldo completo (.zip) ----------
    async function backupZip(projects, notes, onProgress) {
        var zip = new JSZip(), total = projects.length + 1, done = 0;
        var list = [];
        for (var i = 0; i < projects.length; i++) {
            var p = JSON.parse(JSON.stringify(projects[i]));
            delete p._dirty; delete p._syncedAt;
            var pdf = await Data.getPdf(p.id);
            if (pdf) { zip.file('pdf/' + p.id + '.pdf', pdf); p.pdfFile = 'pdf/' + p.id + '.pdf'; }
            var anns = allAnnotations(p);
            for (var j = 0; j < anns.length; j++) {
                var m = anns[j].media;
                if (!m) continue;
                var b = await Data.getBlob(m.key);
                if (b) { var f = 'media/' + m.key + '.' + Data.extFor(m.mime || b.type); zip.file(f, b); m.file = f; }
            }
            list.push(p);
            if (onProgress) onProgress(++done / total);
        }
        zip.file('data.json', JSON.stringify(list));
        zip.file('agenda.json', JSON.stringify((notes || []).map(function(n) { var c = Object.assign({}, n); delete c._dirty; delete c._syncedAt; return c; })));
        zip.file('info.json', JSON.stringify({ format: 'misnotas.respaldo', version: 2, createdAt: new Date().toISOString(), device: Data.device().name }));
        var blob = await zip.generateAsync({ type: 'blob' }, function(m) { if (onProgress) onProgress(0.9 + m.percent / 1000); });
        return blob;
    }

    // Lee un respaldo .zip (formato nuevo o anterior). Devuelve { projects, notes }.
    async function readBackupZip(file, onProgress) {
        var zip = await JSZip.loadAsync(file), df = zip.file('data.json');
        if (!df) throw new Error('El archivo no es un respaldo de Mis Notas.');
        var list = JSON.parse(await df.async('string'));
        if (!Array.isArray(list)) throw new Error('Respaldo inválido.');
        var af = zip.file('agenda.json'), notes = af ? JSON.parse(await af.async('string')) : [];
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (p.pdfFile && zip.file(p.pdfFile)) {
                await Data.putPdf(p.id, new Blob([await zip.file(p.pdfFile).async('arraybuffer')], { type: 'application/pdf' }));
                delete p.pdfFile;
            }
            for (var pg in (p.annotations || {})) {
                for (var j = 0; j < p.annotations[pg].length; j++) {
                    var a = p.annotations[pg][j];
                    var path = (a.media && a.media.file) || a.mediaFile;
                    if (!path || !zip.file(path)) continue;
                    var mime = (a.media && a.media.mime) || a.mediaType || '';
                    var blob = new Blob([await zip.file(path).async('arraybuffer')], { type: mime });
                    var key = (a.media && a.media.key) || path.replace('media/', '').replace(/\.[^.]+$/, '');
                    await Data.putBlob(key, blob);
                    if (a.media) { delete a.media.file; a.media.size = blob.size; }
                    else { a.mediaKey = key; delete a.mediaFile; delete a.mediaType; }
                }
            }
            await Data.migrateProject(p);
            if (onProgress) onProgress((i + 1) / list.length);
        }
        return { projects: list, notes: notes };
    }

    return {
        files: files, text: text, save: save, openExternal: openExternal, safeName: safeName,
        projectJSON: projectJSON, readProjectJSON: readProjectJSON, allAnnotations: allAnnotations,
        backupZip: backupZip, readBackupZip: readBackupZip
    };
})();
