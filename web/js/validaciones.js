/* Sección Validaciones: proyectos con PDF y anotaciones (nota, foto, video,
   audio, tiempo y reemplazo de texto). */
var Validaciones = (function() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

    var projects = [], currentProject = null, pdfDoc = null, currentPageNum = 1, blobCache = {};
    var pageIsRendering = false, pendingRender = null;
    var pdfScale = 1.0, renderedScale = 1.0, autoFit = true, renderTimeout = null;
    var typeNames = { text: 'Nota', photo: 'Foto', video: 'Video', audio: 'Audio', timer: 'Tiempo', replacement: 'Reemplazo' };
    var esc = UI.escapeHtml;
    var $ = function(id) { return document.getElementById(id); };

    // ---------- Almacenamiento ----------
    async function saveBlob(key, blob) { blobCache[key] = blob; return localforage.setItem('blob_' + key, blob); }
    async function getBlob(key) { if (blobCache[key]) return blobCache[key]; var b = await localforage.getItem('blob_' + key); if (b) blobCache[key] = b; return b; }
    async function deleteBlob(key) { delete blobCache[key]; return localforage.removeItem('blob_' + key); }
    function saveData() { if (currentProject) currentProject.timestamp = Date.now(); return localforage.setItem('misnotas_projects', projects); }
    function mediaKey() { return 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); }

    function needPdf() { if (!pdfDoc) { UI.toast('📄 Carga un PDF primero', 'info'); return true; } return false; }

    // ---------- Vistas ----------
    function showView(v) {
        var dash = v === 'dashboard';
        $('view-dashboard').classList.toggle('hidden', !dash);
        $('view-editor').classList.toggle('hidden', dash);
        document.body.classList.toggle('editor-open', !dash);
        if (dash) { currentProject = null; renderProjects(); }
    }

    function isEditorOpen() { return !$('view-editor').classList.contains('hidden'); }

    function closeEditor() { return saveData().then(function() { showView('dashboard'); }); }

    function renderProjects() {
        var c = $('project-list-container'); if (!c) return;
        var q = ($('project-search').value || '').trim().toLowerCase();
        c.innerHTML = '';
        projects.sort(function(a, b) { return b.timestamp - a.timestamp; });
        var list = projects.filter(function(p) { return !q || (p.name || '').toLowerCase().indexOf(q) !== -1; });
        if (list.length === 0) {
            c.innerHTML = '<div class="empty-state"><div class="empty-icon">' + (q ? '🔍' : '📭') + '</div><p>' + (q ? 'Sin resultados' : 'No hay proyectos aún') + '</p>' +
                (q ? '' : '<button class="btn" style="margin-top:14px" id="empty-new">＋ Crear el primero</button>') + '</div>';
            var en = $('empty-new'); if (en) en.addEventListener('click', newProject);
            return;
        }
        list.forEach(function(p) {
            var t = 0; for (var pg in p.annotations) t += p.annotations[pg].length;
            var card = document.createElement('div'); card.className = 'project-card';
            card.innerHTML = '<div class="project-card-header"><span class="project-name">📄 ' + esc(p.name || 'Sin nombre') + '</span>' +
                '<div class="project-actions"><button class="btn-sm" data-edit title="Renombrar">✏️</button><button class="btn-sm" data-delete title="Eliminar" style="color:var(--danger)">🗑️</button></div></div>' +
                '<div class="project-meta"><span>🕒 ' + new Date(p.timestamp).toLocaleDateString() + '</span><span>📌 ' + t + ' notas</span><span>' + (p.pdfData ? '📕 PDF' : '📄 Sin PDF') + '</span></div>';
            card.addEventListener('click', function(e) { if (!e.target.closest('button')) openProject(p.id); });
            card.querySelector('[data-edit]').addEventListener('click', async function(e) {
                e.stopPropagation();
                var n = await UI.prompt('Renombrar proyecto', p.name);
                if (n && n.trim()) { p.name = n.trim(); saveData().then(renderProjects); }
            });
            card.querySelector('[data-delete]').addEventListener('click', async function(e) {
                e.stopPropagation();
                if (!(await UI.confirm('Se eliminará "' + p.name + '" con todas sus anotaciones.', { okText: 'Eliminar', danger: true }))) return;
                for (var pg in p.annotations) for (var i = 0; i < p.annotations[pg].length; i++) if (p.annotations[pg][i].mediaKey) await deleteBlob(p.annotations[pg][i].mediaKey);
                projects = projects.filter(function(x) { return x.id !== p.id; });
                saveData().then(renderProjects);
            });
            c.appendChild(card);
        });
    }

    async function newProject() {
        var n = await UI.prompt('Nombre del proyecto', 'Proyecto ' + (projects.length + 1));
        if (!n || !n.trim()) return;
        var p = { id: 'proj_' + Date.now(), name: n.trim(), timestamp: Date.now(), pdfData: null, annotations: {} };
        projects.push(p);
        saveData().then(function() { openProject(p.id); });
    }

    function openProject(id) {
        currentProject = projects.find(function(p) { return p.id === id; }); if (!currentProject) return;
        $('editor-project-title').textContent = '📄 ' + currentProject.name;
        pdfDoc = null; currentPageNum = 1; pdfScale = renderedScale = 1.0; autoFit = true;
        $('pdf-container').style.display = 'none';
        $('pdf-container').style.transform = '';
        $('annotation-layer').innerHTML = '';
        $('pdf-text-layer').innerHTML = '';
        $('pdf-current-page').textContent = '0';
        $('pdf-total-pages').textContent = '0';
        updateZoomDisplay();
        showView('editor');
        if (currentProject.pdfData) { $('pdf-upload-loader').style.display = 'none'; $('pdf-container').style.display = 'inline-block'; loadPDF(currentProject.pdfData); }
        else { $('pdf-upload-loader').style.display = 'block'; }
    }

    // ---------- PDF ----------
    function loadPDF(b64) {
        var parts = b64.split(','); if (parts.length < 2) return;
        var d = atob(parts[1]), bytes = new Uint8Array(d.length);
        for (var i = 0; i < d.length; i++) bytes[i] = d.charCodeAt(i);
        pdfjsLib.getDocument({ data: bytes }).promise.then(function(pdf) {
            pdfDoc = pdf;
            $('pdf-total-pages').textContent = pdf.numPages;
            return fitScale(false);
        }).then(function() { renderPage(1); })
          .catch(function(err) { console.error(err); UI.toast('No se pudo abrir el PDF', 'error'); });
    }

    // Calcula la escala para que la página quepa. widthOnly = ajustar al ancho.
    function fitScale(widthOnly) {
        if (!pdfDoc) return Promise.resolve();
        return pdfDoc.getPage(currentPageNum).then(function(page) {
            var editorMain = $('editor-main-container');
            var cs = getComputedStyle(editorMain);
            var w = editorMain.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            var h = editorMain.clientHeight - parseFloat(cs.paddingTop) - 24;
            var vp = page.getViewport({ scale: 1 });
            var sx = w / vp.width, sy = h / vp.height;
            // En pantallas angostas (celular vertical) siempre ajustamos al ancho.
            var s = (widthOnly || editorMain.clientWidth < 700) ? sx : Math.min(sx, sy);
            pdfScale = Math.max(0.3, Math.min(s, 3));
            updateZoomDisplay();
        });
    }

    function renderPage(num, keepScroll) {
        if (!pdfDoc) return;
        if (pageIsRendering) { pendingRender = { num: num, keepScroll: keepScroll }; return; }
        var editor = $('editor-main-container');
        var ratio = pdfScale / renderedScale;
        var prevLeft = editor.scrollLeft * ratio, prevTop = editor.scrollTop * ratio;
        pageIsRendering = true;
        var textLayerDiv = $('pdf-text-layer');

        pdfDoc.getPage(num).then(function(page) {
            var scale = pdfScale;
            var vp = page.getViewport({ scale: scale });
            var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
            var canvas = $('pdf-canvas'), ctx = canvas.getContext('2d');
            var container = $('pdf-container');
            // Canvas temporal para no dejar la página en blanco mientras se dibuja
            var off = document.createElement('canvas');
            off.width = Math.floor(vp.width * dpr); off.height = Math.floor(vp.height * dpr);
            var t = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
            return page.render({ canvasContext: off.getContext('2d'), transform: t, viewport: vp }).promise.then(function() {
                canvas.width = off.width; canvas.height = off.height;
                canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
                ctx.drawImage(off, 0, 0);
                container.style.width = Math.floor(vp.width) + 'px';
                container.style.height = Math.floor(vp.height) + 'px';
                container.style.transform = '';
                renderedScale = scale;
                return page.getTextContent();
            }).then(function(tc) {
                textLayerDiv.innerHTML = '';
                pdfjsLib.renderTextLayer({ textContent: tc, container: textLayerDiv, viewport: vp, textDivs: [], enhanceTextSelection: true });
                setTimeout(function() {
                    var spans = textLayerDiv.querySelectorAll('span');
                    for (var i = 0; i < spans.length; i++) {
                        var cw = parseFloat(spans[i].style.width) || 0, ch = parseFloat(spans[i].style.height) || 0;
                        if (cw > 0) spans[i].style.width = (cw * 1.02) + 'px';
                        if (ch > 0) spans[i].style.height = (ch * 1.1) + 'px';
                    }
                }, 50);
                var pageChanged = currentPageNum !== num || $('pdf-current-page').textContent !== String(num);
                currentPageNum = num;
                $('pdf-current-page').textContent = num;
                if (pageChanged || !keepScroll) renderAnnotations();
                if (keepScroll) { editor.scrollLeft = prevLeft; editor.scrollTop = prevTop; }
                else { editor.scrollTop = 0; }
            });
        }).catch(function(err) { console.error(err); }).then(function() {
            pageIsRendering = false;
            if (pendingRender) { var p = pendingRender; pendingRender = null; renderPage(p.num, p.keepScroll); }
        });
    }

    function goToPage(n) {
        if (!pdfDoc || n < 1 || n > pdfDoc.numPages) return;
        closeAllBubbles();
        renderPage(n);
    }

    function updateZoomDisplay(temp) { $('zoom-level').textContent = Math.round((temp || pdfScale) * 100) + '%'; }

    // Zoom: aplica un transform inmediato (fluido) y luego re-renderiza nítido.
    function previewZoom(scale) {
        var c = $('pdf-container');
        c.style.transformOrigin = '0 0';
        c.style.transform = 'scale(' + (scale / renderedScale) + ')';
    }
    function scheduleRender() {
        if (renderTimeout) clearTimeout(renderTimeout);
        renderTimeout = setTimeout(function() {
            renderTimeout = null;
            if (pdfDoc && Math.abs(pdfScale - renderedScale) > 0.005) renderPage(currentPageNum, true);
            else $('pdf-container').style.transform = '';
        }, 350);
    }
    function setZoom(s) {
        if (!pdfDoc) return;
        autoFit = false;
        pdfScale = Math.max(0.3, Math.min(4, s));
        updateZoomDisplay();
        previewZoom(pdfScale);
        scheduleRender();
    }

    function initZoom() {
        var editorMain = $('editor-main-container');
        $('btn-zoom-in').addEventListener('click', function() { setZoom(pdfScale + 0.25); });
        $('btn-zoom-out').addEventListener('click', function() { setZoom(pdfScale - 0.25); });
        $('btn-zoom-fit').addEventListener('click', function() {
            if (!pdfDoc) return;
            autoFit = true;
            fitScale(true).then(function() { renderPage(currentPageNum); });
        });

        // Pellizco con dos dedos + doble toque para ajustar
        var pinchDist = 0, pinchStart = 1, lastTap = 0, pinchScale = 1;
        editorMain.addEventListener('touchstart', function(e) {
            if (!pdfDoc) return;
            if (e.touches.length === 2) {
                e.preventDefault();
                pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                pinchStart = pinchScale = pdfScale;
                if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }
            } else if (e.touches.length === 1 && !e.target.closest('.annotation-wrapper')) {
                var now = Date.now();
                if (now - lastTap < 300) {
                    e.preventDefault();
                    autoFit = true;
                    fitScale(false).then(function() { renderPage(currentPageNum); });
                }
                lastTap = now;
            }
        }, { passive: false });
        editorMain.addEventListener('touchmove', function(e) {
            if (e.touches.length === 2 && pinchDist > 0) {
                e.preventDefault();
                var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                pinchScale = Math.max(0.3, Math.min(4, pinchStart * (d / pinchDist)));
                previewZoom(pinchScale);
                updateZoomDisplay(pinchScale);
            }
        }, { passive: false });
        editorMain.addEventListener('touchend', function(e) {
            if (pinchDist > 0 && e.touches.length < 2) {
                pinchDist = 0;
                autoFit = false;
                pdfScale = pinchScale;
                updateZoomDisplay();
                scheduleRender();
            }
        });

        // Ctrl + rueda en PC
        editorMain.addEventListener('wheel', function(e) {
            if (!pdfDoc || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            setZoom(pdfScale + (e.deltaY > 0 ? -0.1 : 0.1));
        }, { passive: false });

        // Re-ajustar al girar el dispositivo o cambiar el tamaño de la ventana
        var rt = null;
        window.addEventListener('resize', function() {
            if (!pdfDoc || !autoFit || !isEditorOpen()) return;
            clearTimeout(rt);
            rt = setTimeout(function() { fitScale(false).then(function() { renderPage(currentPageNum, true); }); }, 250);
        });
    }

    // ---------- Imagen a pantalla completa ----------
    function openFullscreenImage(src) {
        var ov = document.createElement('div'); ov.className = 'fullscreen-overlay';
        ov.innerHTML = '<img src="' + src + '" draggable="false"><div class="fullscreen-close">✕</div>';
        document.body.appendChild(ov);
        var img = ov.querySelector('img'), sc = 1, px = 0, py = 0, sp = { x: 0, y: 0 }, pan = false, pd = 0, ps = 1;
        function up() { img.style.transform = 'translate(' + px + 'px,' + py + 'px) scale(' + sc + ')'; }
        ov.addEventListener('touchstart', function(e) { if (e.touches.length === 2) { pd = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); ps = sc; } else if (e.touches.length === 1 && sc > 1) { pan = true; sp.x = e.touches[0].clientX - px; sp.y = e.touches[0].clientY - py; } });
        ov.addEventListener('touchmove', function(e) { if (e.touches.length === 2 && pd > 0) { e.preventDefault(); var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); sc = Math.max(1, Math.min(ps * (d / pd), 5)); up(); } else if (e.touches.length === 1 && pan) { e.preventDefault(); px = e.touches[0].clientX - sp.x; py = e.touches[0].clientY - sp.y; up(); } }, { passive: false });
        ov.addEventListener('touchend', function() { pd = 0; pan = false; });
        ov.addEventListener('wheel', function(e) { e.preventDefault(); sc += e.deltaY * -0.005; sc = Math.max(1, Math.min(sc, 5)); up(); }, { passive: false });
        function mm(e) { if (pan) { px = e.clientX - sp.x; py = e.clientY - sp.y; up(); } }
        function mu() { pan = false; }
        img.addEventListener('mousedown', function(e) { e.preventDefault(); if (sc > 1) { pan = true; sp.x = e.clientX - px; sp.y = e.clientY - py; } });
        window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
        var popLayer = UI.pushLayer(close);
        function close() { popLayer(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); ov.classList.remove('show'); setTimeout(function() { ov.remove(); }, 300); }
        ov.querySelector('.fullscreen-close').addEventListener('click', close);
        ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
        requestAnimationFrame(function() { ov.classList.add('show'); });
    }

    // ---------- Cámara / galería / video ----------
    function initCamera() {
        $('btn-dock-camera').addEventListener('click', async function() {
            if (needPdf()) return;
            var opt = await UI.choice('Agregar multimedia', [
                { label: '📷 Tomar foto', value: 'photo', primary: true },
                { label: '🎬 Grabar video', value: 'video' },
                { label: '🖼️ Elegir de la galería', value: 'gallery' }
            ]);
            if (opt === 'photo') $('file-camera').click();
            else if (opt === 'video') recordVideo();
            else if (opt === 'gallery') $('file-gallery').click();
        });
        function onFile(e) {
            var f = e.target.files[0]; e.target.value = '';
            if (!f) return;
            var isV = f.type.indexOf('video/') === 0, key = mediaKey();
            saveBlob(key, f).then(function() { addAnnotation(45, 40, '', isV ? 'video' : 'photo', null, key); });
        }
        $('file-camera').addEventListener('change', onFile);
        $('file-gallery').addEventListener('change', onFile);
    }

    function recordVideo() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { $('file-camera').click(); return; }
        var modal = document.createElement('div'); modal.className = 'video-recorder';
        modal.innerHTML = '<video autoplay muted playsinline></video><div class="recorder-bar"><div class="rec-circle" id="rec-start">⏺</div><span class="rec-timer" id="rec-timer">00:00</span><div class="rec-circle" id="rec-stop" style="display:none">⏹</div><div class="rec-circle" id="rec-close">✕</div></div>';
        document.body.appendChild(modal);
        var video = modal.querySelector('video'), bs = modal.querySelector('#rec-start'), bp = modal.querySelector('#rec-stop'), bc = modal.querySelector('#rec-close'), te = modal.querySelector('#rec-timer'), rec, chunks = [], stream, timer, secs = 0, discard = false;
        var popLayer = UI.pushLayer(function() { discard = true; stop(); });
        function cleanup() { popLayer(); clearInterval(timer); if (stream) stream.getTracks().forEach(function(t) { t.stop(); }); modal.remove(); }
        function stop() { if (rec && rec.state === 'recording') rec.stop(); else cleanup(); }
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true }).then(function(s) {
            stream = s; video.srcObject = s;
            bs.addEventListener('click', function() {
                chunks = []; rec = new MediaRecorder(s);
                rec.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
                rec.onstop = async function() {
                    if (!discard) { var blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' }); var key = mediaKey(); await saveBlob(key, blob); addAnnotation(45, 40, '', 'video', null, key); }
                    cleanup();
                };
                rec.start(); bs.style.display = 'none'; bp.style.display = 'flex'; bp.classList.add('active'); secs = 0;
                timer = setInterval(function() { secs++; te.textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0'); }, 1000);
            });
            bp.addEventListener('click', stop);
            bc.addEventListener('click', stop);
        }).catch(function() { cleanup(); UI.toast('Sin acceso a la cámara, usando la cámara del sistema', 'info'); $('file-camera').click(); });
    }

    // ---------- Anotaciones ----------
    function addAnnotation(x, y, text, type, url, key, applyOffset) {
        if (applyOffset === undefined) applyOffset = true; text = text || '';
        if (applyOffset && type !== 'replacement') { x += (Math.random() * 10) - 5; y += (Math.random() * 10) - 5; }
        x = Math.max(2, Math.min(95, x)); y = Math.max(2, Math.min(95, y));
        var ann = { id: 'a_' + Date.now(), x: x, y: y, text: text, type: type, mediaUrl: url || null, mediaKey: key || null };
        if (!currentProject.annotations[currentPageNum]) currentProject.annotations[currentPageNum] = [];
        currentProject.annotations[currentPageNum].push(ann);
        drawAnnotation(ann, true, true); saveData();
    }

    function addReplacement(rects, original) {
        var r = rects[0];
        var x = Math.max(2, Math.min(95, r.x + r.w + 2)), y = Math.max(2, Math.min(95, r.y));
        var ann = { id: 'a_' + Date.now(), x: x, y: y, rects: rects, originalText: original, text: '', type: 'replacement' };
        if (!currentProject.annotations[currentPageNum]) currentProject.annotations[currentPageNum] = [];
        currentProject.annotations[currentPageNum].push(ann);
        drawAnnotation(ann, true, true); saveData();
    }

    var symbols = { photo: '📷', video: '🎬', audio: '🎵', timer: '⏱️', replacement: '✏️' };
    var badges = { text: 'badge-note', photo: 'badge-photo', video: 'badge-video', audio: 'badge-audio', timer: 'badge-timer', replacement: 'badge-reemplazo' };
    var placeholders = { text: 'Escribe tu nota...', replacement: 'Reemplazo...', photo: 'Nota de la foto...', video: 'Nota del video...', audio: 'Nota del audio...', timer: 'Nota del tiempo...' };

    async function drawAnnotation(ann, autoExpand, glow) {
        var wrap = document.createElement('div'); wrap.className = 'annotation-wrapper';
        wrap.style.left = ann.x + '%'; wrap.style.top = ann.y + '%'; wrap.id = 'wrap-' + ann.id;
        if (ann.x > 55) wrap.classList.add('flip');
        var idx = (currentProject.annotations[currentPageNum] || []).indexOf(ann) + 1;
        var symbol = symbols[ann.type] || idx;

        if (ann.type === 'replacement' && ann.rects) {
            ann.rects.forEach(function(r) {
                var s = document.createElement('div'); s.className = 'strike-overlay strike-' + ann.id;
                s.style.left = r.x + '%'; s.style.top = (r.y + r.h / 2) + '%'; s.style.width = r.w + '%';
                $('annotation-layer').appendChild(s);
            });
        }

        var displayUrl = ann.type === 'timer' ? null : ann.mediaUrl;
        if (ann.mediaKey) { var blob = await getBlob(ann.mediaKey); if (blob) displayUrl = URL.createObjectURL(blob); }

        var html = '<div class="annotation-pin' + (ann.type === 'replacement' ? ' pin-replacement' : '') + (glow ? ' glow-effect' : '') + '"><span>' + symbol + '</span></div>' +
            '<div class="annotation-bubble' + (autoExpand ? '' : ' hidden') + (ann.type === 'replacement' ? ' bubble-replacement' : '') + '" id="bubble-' + ann.id + '">' +
            '<div class="bubble-header"><span class="bubble-type-badge ' + (badges[ann.type] || 'badge-note') + '">' + (typeNames[ann.type] || ann.type) + '</span><span>#' + idx + '</span></div>';
        if (ann.type === 'replacement') html += '<div class="bubble-original"><span style="color:var(--text-secondary);">Original: </span>' + esc(ann.originalText || '') + '</div>';
        else if (ann.type === 'photo') html += '<img src="' + displayUrl + '" data-full loading="lazy" alt="Foto">';
        else if (ann.type === 'video') html += '<video controls playsinline src="' + displayUrl + '" preload="metadata"></video>';
        else if (ann.type === 'audio') html += '<audio controls src="' + displayUrl + '" style="width:100%;"></audio>';
        else if (ann.type === 'timer') html += '<div class="time-badge">⏱️ ' + esc(ann.mediaUrl || '00:00.00') + '</div>';
        html += '<textarea id="ta-' + ann.id + '" placeholder="' + (placeholders[ann.type] || '') + '">' + esc(ann.text || '') + '</textarea>';
        html += '<button class="btn-sm" style="color:var(--danger);align-self:flex-end;width:auto;padding:0 10px;" id="del-' + ann.id + '">🗑️ Eliminar</button></div>';
        wrap.innerHTML = html;
        if (autoExpand) wrap.classList.add('open');
        $('annotation-layer').appendChild(wrap);

        var bubble = wrap.querySelector('.annotation-bubble');
        bubble.addEventListener('click', function(e) { e.stopPropagation(); });
        var full = wrap.querySelector('[data-full]'); if (full) full.addEventListener('click', function() { openFullscreenImage(full.src); });
        if (glow) { var pin = wrap.querySelector('.annotation-pin'); pin.addEventListener('animationend', function() { pin.classList.remove('glow-effect'); }); }
        $('del-' + ann.id).addEventListener('click', function() { deleteAnnotation(ann.id); });
        makeDraggable(wrap, ann);
        var ta = $('ta-' + ann.id);
        var st = null;
        ta.addEventListener('input', function() { ann.text = ta.value; clearTimeout(st); st = setTimeout(saveData, 400); });
    }

    function toggleBubble(wrap, ann) {
        var b = $('bubble-' + ann.id); if (!b) return;
        var hidden = b.classList.contains('hidden');
        closeAllBubbles();
        if (hidden) { b.classList.remove('hidden'); wrap.classList.add('open'); }
    }

    function makeDraggable(wrap, ann) {
        var pin = wrap.querySelector('.annotation-pin');
        if (ann.type === 'replacement') {
            pin.addEventListener('click', function(e) { e.stopPropagation(); toggleBubble(wrap, ann); });
            return;
        }
        var dragging = false, wasDragged = false, sx, sy, ox, oy;
        function point(e) { return e.touches ? e.touches[0] : e; }
        function start(e) {
            dragging = true; wasDragged = false;
            var p = point(e), r = wrap.getBoundingClientRect();
            sx = p.clientX - r.left; sy = p.clientY - r.top; ox = p.clientX; oy = p.clientY;
            pin.style.cursor = 'grabbing';
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', end);
            document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', end);
        }
        function move(e) {
            if (!dragging) return;
            var p = point(e);
            if (!wasDragged && Math.hypot(p.clientX - ox, p.clientY - oy) < 6) return; // tolerancia para toques
            wasDragged = true; if (e.cancelable) e.preventDefault();
            var cr = $('pdf-container').getBoundingClientRect();
            var xp = Math.max(0, Math.min(100, ((p.clientX - cr.left - sx) / cr.width) * 100));
            var yp = Math.max(0, Math.min(100, ((p.clientY - cr.top - sy) / cr.height) * 100));
            wrap.style.left = xp + '%'; wrap.style.top = yp + '%'; ann.x = xp; ann.y = yp;
            wrap.classList.toggle('flip', xp > 55);
        }
        function end() {
            dragging = false; pin.style.cursor = 'pointer';
            if (wasDragged) saveData();
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', end);
            document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end);
        }
        pin.addEventListener('mousedown', start);
        pin.addEventListener('touchstart', function(e) { e.stopPropagation(); start(e); }, { passive: true });
        pin.addEventListener('click', function(e) { e.stopPropagation(); if (!wasDragged) toggleBubble(wrap, ann); });
    }

    function closeAllBubbles() {
        document.querySelectorAll('.annotation-bubble').forEach(function(b) { b.classList.add('hidden'); });
        document.querySelectorAll('.annotation-wrapper.open').forEach(function(w) { w.classList.remove('open'); });
    }
    function hasOpenBubble() { return !!document.querySelector('.annotation-bubble:not(.hidden)'); }

    async function deleteAnnotation(id) {
        if (!(await UI.confirm('Se eliminará esta anotación.', { okText: 'Eliminar', danger: true }))) return;
        var anns = currentProject.annotations[currentPageNum] || [];
        var ann = anns.find(function(a) { return a.id === id; });
        if (ann && ann.mediaKey) await deleteBlob(ann.mediaKey);
        currentProject.annotations[currentPageNum] = anns.filter(function(a) { return a.id !== id; });
        saveData();
        renderAnnotations();
    }

    function renderAnnotations() {
        $('annotation-layer').innerHTML = '';
        if (!currentProject) return;
        (currentProject.annotations[currentPageNum] || []).forEach(function(a) { drawAnnotation(a, false, false); });
    }

    // Arrastrar una nota nueva desde el dock hasta el documento.
    // En PC/tablet también se puede hacer clic para colocarla en el centro visible.
    function initDragNote() {
        var btn = $('btn-dock-note');
        function startDragNote(e) {
            if (needPdf()) return;
            if (e.cancelable) e.preventDefault();
            var ghost = document.createElement('div'); ghost.className = 'annotation-pin';
            ghost.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;'; ghost.innerHTML = '<span>📝</span>';
            document.body.appendChild(ghost);
            var p0 = e.touches ? e.touches[0] : e, sx = p0.clientX, sy = p0.clientY, moved = false;
            function place(ev) { var p = ev.touches ? ev.touches[0] : ev; ghost.style.left = (p.clientX - 16) + 'px'; ghost.style.top = (p.clientY - 16) + 'px'; if (Math.hypot(p.clientX - sx, p.clientY - sy) > 8) moved = true; }
            place(e);
            function moveH(ev) { if (ev.cancelable) ev.preventDefault(); place(ev); }
            function end(ev) {
                document.removeEventListener('mousemove', moveH); document.removeEventListener('mouseup', end);
                document.removeEventListener('touchmove', moveH); document.removeEventListener('touchend', end);
                ghost.remove();
                var p = ev.changedTouches ? ev.changedTouches[0] : ev, cr = $('pdf-container').getBoundingClientRect();
                if (!moved) {
                    // Toque simple: colocar en el centro de la zona visible
                    var er = $('editor-main-container').getBoundingClientRect();
                    var cx = Math.max(cr.left, Math.min(cr.right, er.left + er.width / 2)), cy = Math.max(cr.top, Math.min(cr.bottom, er.top + er.height / 3));
                    addAnnotation(((cx - cr.left) / cr.width) * 100, ((cy - cr.top) / cr.height) * 100, '', 'text', null, null, true);
                } else if (p.clientX >= cr.left && p.clientX <= cr.right && p.clientY >= cr.top && p.clientY <= cr.bottom) {
                    addAnnotation(((p.clientX - cr.left) / cr.width) * 100, ((p.clientY - cr.top) / cr.height) * 100, '', 'text', null, null, false);
                }
            }
            document.addEventListener('mousemove', moveH); document.addEventListener('mouseup', end);
            document.addEventListener('touchmove', moveH, { passive: false }); document.addEventListener('touchend', end);
        }
        btn.addEventListener('mousedown', startDragNote);
        btn.addEventListener('touchstart', startDragNote, { passive: false });
    }

    function initReplacement() {
        $('btn-dock-replacement').addEventListener('mousedown', function(e) { e.preventDefault(); }); // no perder la selección en PC
        $('btn-dock-replacement').addEventListener('click', function() {
            if (needPdf()) return;
            var sel = window.getSelection(), text = sel.toString().trim();
            if (!text || !sel.rangeCount) { UI.toast('✏️ Primero selecciona el texto a reemplazar', 'info'); return; }
            var rects = sel.getRangeAt(0).getClientRects();
            if (rects.length === 0) return;
            var cr = $('pdf-container').getBoundingClientRect(), strikeRects = [], valid = true;
            for (var i = 0; i < rects.length; i++) {
                var r = rects[i];
                if (r.width < 1) continue;
                if (r.left >= cr.left - 1 && r.right <= cr.right + 1 && r.top >= cr.top - 1 && r.bottom <= cr.bottom + 1) {
                    strikeRects.push({ x: ((r.left - cr.left) / cr.width) * 100, y: ((r.top - cr.top) / cr.height) * 100, w: (r.width / cr.width) * 100, h: (r.height / cr.height) * 100 });
                } else valid = false;
            }
            if (valid && strikeRects.length > 0) { sel.removeAllRanges(); addReplacement(strikeRects, text); }
            else UI.toast('Selecciona texto dentro del documento', 'error');
        });
    }

    function initAudio() {
        var rec, chunks = [], recording = false, btn = $('btn-dock-audio');
        btn.addEventListener('click', function() {
            if (needPdf()) return;
            if (!recording) {
                if (!navigator.mediaDevices || !window.MediaRecorder) { UI.toast('La grabación de audio no está disponible', 'error'); return; }
                navigator.mediaDevices.getUserMedia({ audio: true }).then(function(s) {
                    rec = new MediaRecorder(s);
                    rec.ondataavailable = function(e) { chunks.push(e.data); };
                    rec.onstop = async function() {
                        var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), key = mediaKey();
                        await saveBlob(key, blob); addAnnotation(50, 45, '', 'audio', null, key);
                        chunks = []; s.getTracks().forEach(function(t) { t.stop(); });
                    };
                    rec.start(); recording = true; btn.classList.add('dock-btn-recording');
                    UI.toast('🎤 Grabando… toca de nuevo para terminar', 'info');
                }).catch(function() { UI.toast('Permite el acceso al micrófono', 'error'); });
            } else {
                if (rec && rec.state === 'recording') rec.stop();
                recording = false; btn.classList.remove('dock-btn-recording');
            }
        });
    }

    function initTimer() {
        var modal = $('timer-modal'), display = $('timer-display'), bs = $('btn-timer-start'), bp = $('btn-timer-stop'), bv = $('btn-timer-save'), bc = $('btn-timer-cancel'), interval, st = 0, elapsed = 0, running = false, popLayer = null;
        function fmt(ms) { var s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + '.' + String(Math.floor((ms % 1000) / 10)).padStart(2, '0'); }
        function upd() { display.textContent = fmt(elapsed + (running ? Date.now() - st : 0)); }
        function reset() { running = false; clearInterval(interval); elapsed = 0; upd(); bs.classList.remove('hidden'); bp.classList.add('hidden'); bv.disabled = true; }
        function hide() { reset(); modal.classList.add('hidden'); if (popLayer) { popLayer(); popLayer = null; } }
        $('btn-dock-timer').addEventListener('click', function() { if (needPdf()) return; reset(); modal.classList.remove('hidden'); popLayer = UI.pushLayer(hide); });
        bs.addEventListener('click', function() { st = Date.now(); running = true; interval = setInterval(upd, 30); bs.classList.add('hidden'); bp.classList.remove('hidden'); bv.disabled = true; });
        bp.addEventListener('click', function() { running = false; clearInterval(interval); elapsed += Date.now() - st; upd(); bs.classList.remove('hidden'); bp.classList.add('hidden'); bv.disabled = false; });
        bc.addEventListener('click', hide);
        bv.addEventListener('click', function() { var t = fmt(elapsed); hide(); addAnnotation(50, 50, '', 'timer', t, null); });
    }

    function init() {
        initZoom();
        initCamera();
        initDragNote();
        initReplacement();
        initAudio();
        initTimer();

        $('btn-new-project').addEventListener('click', newProject);
        $('project-search').addEventListener('input', renderProjects);
        $('file-pdf').addEventListener('change', function(e) {
            var f = e.target.files[0]; e.target.value = '';
            if (!f || !currentProject) return;
            var r = new FileReader();
            r.onload = function() {
                currentProject.pdfData = r.result;
                saveData().then(function() { $('pdf-upload-loader').style.display = 'none'; $('pdf-container').style.display = 'inline-block'; loadPDF(currentProject.pdfData); });
            };
            r.readAsDataURL(f);
        });
        $('pdf-prev').addEventListener('click', function() { goToPage(currentPageNum - 1); });
        $('pdf-next').addEventListener('click', function() { goToPage(currentPageNum + 1); });
        $('btn-save-exit').addEventListener('click', function() { closeEditor().then(function() { UI.toast('💾 Guardado'); }); });
        $('btn-back-dashboard').addEventListener('click', closeEditor);
        $('pdf-container').addEventListener('click', function(e) {
            if (!e.target.closest('.annotation-pin') && !e.target.closest('.annotation-bubble')) closeAllBubbles();
        });

        document.addEventListener('keydown', function(e) {
            if (!isEditorOpen() || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
            if (e.key === 'ArrowLeft' || e.key === 'PageUp') goToPage(currentPageNum - 1);
            else if (e.key === 'ArrowRight' || e.key === 'PageDown') goToPage(currentPageNum + 1);
            else if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setZoom(pdfScale + 0.25); }
            else if (e.key === '-' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setZoom(pdfScale - 0.25); }
        });

        return localforage.getItem('misnotas_projects').then(function(val) { projects = val || []; renderProjects(); });
    }

    // Botón atrás: cierra burbujas o vuelve al panel.
    function handleBack() {
        if (!isEditorOpen()) return false;
        if (hasOpenBubble()) { closeAllBubbles(); return true; }
        closeEditor();
        return true;
    }

    return {
        init: init,
        handleBack: handleBack,
        isEditorOpen: isEditorOpen,
        getProjects: function() { return projects; },
        setProjects: function(list) { projects = list; return saveData().then(renderProjects); },
        getBlob: getBlob,
        saveBlob: saveBlob,
        renderProjects: renderProjects
    };
})();
