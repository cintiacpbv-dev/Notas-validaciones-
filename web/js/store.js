/* Almacenamiento local (IndexedDB vía localforage).
   - Los proyectos se guardan como JSON liviano (se sincronizan con Supabase).
   - El PDF y la multimedia se guardan como archivos binarios SOLO en este dispositivo. */
var Data = (function() {
    localforage.config({ name: 'MisNotasDB', storeName: 'projects_store' });

    var PROJECTS_KEY = 'misnotas_projects';
    var TOMB_KEY = 'misnotas_tombstones';
    var DEVICE_ID_KEY = 'misnotas-device-id';
    var DEVICE_NAME_KEY = 'misnotas-device-name';
    var cache = {};

    function ls(key, val) {
        try {
            if (val === undefined) return localStorage.getItem(key);
            if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
        } catch (e) { return null; }
    }

    function uid(prefix) {
        var r = (window.crypto && crypto.getRandomValues) ? Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(6)), function(b) { return ('0' + b.toString(16)).slice(-2); }).join('') : Math.random().toString(16).slice(2, 14);
        return (prefix || 'id') + '_' + Date.now().toString(36) + r;
    }

    // ---------- Dispositivo ----------
    function guessDeviceName() {
        var ua = navigator.userAgent || '';
        if (window.AndroidBridge) return /Tablet|SM-T|SM-X|Pad/i.test(ua) || Math.min(screen.width, screen.height) >= 600 ? 'Tablet Android' : 'Celular Android';
        if (/iPad/.test(ua)) return 'iPad';
        if (/iPhone/.test(ua)) return 'iPhone';
        if (/Android/.test(ua)) return 'Android';
        if (/Windows/.test(ua)) return 'PC Windows';
        if (/Macintosh/.test(ua)) return 'Mac';
        return 'Navegador';
    }
    function device() {
        var id = ls(DEVICE_ID_KEY);
        if (!id) { id = uid('dev'); ls(DEVICE_ID_KEY, id); }
        return { id: id, name: ls(DEVICE_NAME_KEY) || guessDeviceName() };
    }
    function setDeviceName(name) { ls(DEVICE_NAME_KEY, name ? name.trim() : null); }

    // ---------- Archivos binarios (solo este dispositivo) ----------
    function putBlob(key, blob) { cache[key] = blob; return localforage.setItem('blob_' + key, blob); }
    function getBlob(key) {
        if (!key) return Promise.resolve(null);
        if (cache[key]) return Promise.resolve(cache[key]);
        return localforage.getItem('blob_' + key).then(function(b) { if (b) cache[key] = b; return b; });
    }
    function delBlob(key) { delete cache[key]; return localforage.removeItem('blob_' + key); }
    function putPdf(projectId, blob) { return putBlob('pdf_' + projectId, blob); }
    function getPdf(projectId) { return getBlob('pdf_' + projectId); }
    function delPdf(projectId) { return delBlob('pdf_' + projectId); }

    // ---------- Utilidades ----------
    function dataUrlToBlob(dataUrl) {
        var i = dataUrl.indexOf(','), meta = dataUrl.slice(5, i), b64 = meta.indexOf(';base64') !== -1;
        var mime = meta.split(';')[0] || 'application/octet-stream';
        var raw = b64 ? atob(dataUrl.slice(i + 1)) : decodeURIComponent(dataUrl.slice(i + 1));
        var bytes = new Uint8Array(raw.length);
        for (var j = 0; j < raw.length; j++) bytes[j] = raw.charCodeAt(j);
        return new Blob([bytes], { type: mime });
    }
    function blobToDataUrl(blob) {
        return new Promise(function(resolve, reject) {
            var r = new FileReader();
            r.onload = function() { resolve(r.result); };
            r.onerror = reject;
            r.readAsDataURL(blob);
        });
    }
    function sha256(blob) {
        if (!window.crypto || !crypto.subtle) return Promise.resolve(null);
        return blob.arrayBuffer().then(function(buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function(h) {
            return Array.prototype.map.call(new Uint8Array(h), function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        }).catch(function() { return null; });
    }
    function extFor(mime) {
        var map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf' };
        var base = (mime || '').split(';')[0];
        return map[base] || (base.split('/')[1] || 'bin');
    }
    function formatBytes(n) {
        if (!n && n !== 0) return '';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
        return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
    }

    // ---------- Proyectos ----------
    var DEFAULT_MIME = { photo: 'image/jpeg', video: 'video/webm', audio: 'audio/webm' };

    // Convierte proyectos del formato anterior (PDF en base64 dentro del JSON).
    async function migrateProject(p) {
        var changed = false;
        if (!p.createdAt) { p.createdAt = p.timestamp || Date.now(); changed = true; }
        if (!p.updatedAt) { p.updatedAt = p.timestamp || Date.now(); changed = true; }
        if (p.pdfData) {
            try {
                var blob = dataUrlToBlob(p.pdfData);
                await putPdf(p.id, blob);
                p.pdf = { name: p.pdfName || 'documento.pdf', size: blob.size, pages: null, hash: await sha256(blob) };
            } catch (e) { console.warn('No se pudo migrar el PDF', e); }
            delete p.pdfData;
            changed = true;
        }
        if (p.pdf === undefined) { p.pdf = null; changed = true; }
        p.annotations = p.annotations || {};
        var dev = device();
        Object.keys(p.annotations).forEach(function(pg) {
            (p.annotations[pg] || []).forEach(function(a) {
                if (!a.status) { a.status = 'open'; changed = true; }
                if (!a.createdAt) { a.createdAt = p.updatedAt; changed = true; }
                if (a.type === 'timer' && a.mediaUrl && !a.time) { a.time = a.mediaUrl; changed = true; }
                if (a.mediaKey && !a.media) {
                    a.media = { key: a.mediaKey, mime: DEFAULT_MIME[a.type] || 'application/octet-stream', size: null, device: dev, capturedAt: a.createdAt };
                    changed = true;
                }
                if ('mediaUrl' in a || 'mediaKey' in a) { delete a.mediaUrl; delete a.mediaKey; changed = true; }
            });
        });
        // Numeración estable de observaciones (#1, #2…) aunque se borren algunas
        var pages = Object.keys(p.annotations).sort(function(a, b) { return a - b; });
        var maxN = p.seq || 0;
        pages.forEach(function(pg) { p.annotations[pg].forEach(function(a) { if (a.n > maxN) maxN = a.n; }); });
        pages.forEach(function(pg) { p.annotations[pg].forEach(function(a) { if (!a.n) { a.n = ++maxN; changed = true; } }); });
        if (p.seq !== maxN) { p.seq = maxN; changed = true; }
        if ('timestamp' in p) changed = true;
        delete p.timestamp;
        if (p.schema !== 2) changed = true;
        p.schema = 2;
        return changed;
    }

    async function loadProjects() {
        var list = (await localforage.getItem(PROJECTS_KEY)) || [];
        var changed = false;
        for (var i = 0; i < list.length; i++) {
            if (await migrateProject(list[i])) changed = true;
        }
        if (changed) await localforage.setItem(PROJECTS_KEY, list);
        return list;
    }
    function saveProjects(list) { return localforage.setItem(PROJECTS_KEY, list); }

    // ---------- Lápidas (borrados pendientes de sincronizar) ----------
    async function tombstones(table) { var all = (await localforage.getItem(TOMB_KEY)) || {}; return all[table] || []; }
    async function addTombstone(table, id) {
        var all = (await localforage.getItem(TOMB_KEY)) || {};
        all[table] = (all[table] || []).filter(function(t) { return t.id !== id; });
        all[table].push({ id: id, at: Date.now() });
        return localforage.setItem(TOMB_KEY, all);
    }
    async function clearTombstones(table, ids) {
        var all = (await localforage.getItem(TOMB_KEY)) || {};
        all[table] = (all[table] || []).filter(function(t) { return ids.indexOf(t.id) === -1; });
        return localforage.setItem(TOMB_KEY, all);
    }

    return {
        uid: uid, device: device, setDeviceName: setDeviceName, ls: ls,
        putBlob: putBlob, getBlob: getBlob, delBlob: delBlob,
        putPdf: putPdf, getPdf: getPdf, delPdf: delPdf,
        dataUrlToBlob: dataUrlToBlob, blobToDataUrl: blobToDataUrl, sha256: sha256, extFor: extFor, formatBytes: formatBytes,
        migrateProject: migrateProject, loadProjects: loadProjects, saveProjects: saveProjects,
        tombstones: tombstones, addTombstone: addTombstone, clearTombstones: clearTombstones
    };
})();
