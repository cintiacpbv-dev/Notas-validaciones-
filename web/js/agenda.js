/* Mi Agenda: notas personales con calendario, listas de pendientes,
   colores, stickers y categorías. Estilo kawaii con moños rosas. */
var Agenda = (function() {
    var STORE_KEY = 'agenda_notes', NAME_KEY = 'agenda_name';
    var notes = [], filter = 'all', query = '', tab = 'notes';
    var calMonth = startOfMonth(new Date()), selectedDay = dateKey(new Date());
    var esc = UI.escapeHtml;
    var $ = function(id) { return document.getElementById(id); };

    var COLORS = [
        { id: 'pink', label: 'Rosa' }, { id: 'red', label: 'Fresa' }, { id: 'yellow', label: 'Vainilla' },
        { id: 'mint', label: 'Menta' }, { id: 'lavender', label: 'Lavanda' }, { id: 'sky', label: 'Cielo' }, { id: 'white', label: 'Lunares' }
    ];
    var CATEGORIES = [
        { id: 'personal', label: '💖 Personal' }, { id: 'trabajo', label: '💼 Trabajo' }, { id: 'ideas', label: '💡 Ideas' },
        { id: 'compras', label: '🛍️ Compras' }, { id: 'importante', label: '⭐ Importante' }
    ];
    var STICKERS = ['🎀', '💖', '🌸', '🍓', '⭐', '🍰', '🐾', '🐶', '🌈', '☕', '📚', '✈️', '🎂', '💊', '🛒', '💡', '🏃‍♀️', '🎵'];
    var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

    // ---------- Fechas ----------
    function pad(n) { return String(n).padStart(2, '0'); }
    function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
    function todayKey() { return dateKey(new Date()); }
    function longDate(k) { var d = parseKey(k); return DAYS[d.getDay()] + ' ' + d.getDate() + ' de ' + MONTHS[d.getMonth()]; }
    function shortDate(k) {
        var t = todayKey(); if (k === t) return 'Hoy';
        var tm = new Date(); tm.setDate(tm.getDate() + 1); if (k === dateKey(tm)) return 'Mañana';
        var d = parseKey(k); return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
    }
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    // ---------- Datos ----------
    function save() { return localforage.setItem(STORE_KEY, notes); }
    // Marca una nota como modificada para enviarla a la nube (si está conectada)
    function changed(n) { if (n) { n.updated = Date.now(); n._dirty = true; } var p = save(); Sync.schedule(); return p; }
    function clean(n) { var c = Object.assign({}, n); delete c._dirty; delete c._syncedAt; return c; }
    function catLabel(id) { var c = CATEGORIES.find(function(x) { return x.id === id; }); return c ? c.label : ''; }
    function matches(n) {
        if (filter === 'pinned' && !n.pinned) return false;
        if (filter !== 'all' && filter !== 'pinned' && n.category !== filter) return false;
        if (!query) return true;
        var hay = (n.title + ' ' + n.body + ' ' + (n.checklist || []).map(function(i) { return i.text; }).join(' ')).toLowerCase();
        return hay.indexOf(query) !== -1;
    }
    function sortNotes(list) {
        return list.slice().sort(function(a, b) {
            if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
            return b.updated - a.updated;
        });
    }
    function notesOn(k) {
        return notes.filter(function(n) { return n.date === k; }).sort(function(a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
    }

    // ---------- Encabezado / saludo ----------
    function renderHero() {
        var h = new Date().getHours();
        var saludo = h < 12 ? '¡Buenos días' : h < 19 ? '¡Buenas tardes' : '¡Buenas noches';
        var name = localStorage.getItem(NAME_KEY);
        $('k-greeting').textContent = saludo + (name ? ', ' + name : '') + '! 🎀';
        $('k-today').textContent = cap(longDate(todayKey())) + ' de ' + new Date().getFullYear();
        var today = notesOn(todayKey()).length;
        var pending = 0; notes.forEach(function(n) { (n.checklist || []).forEach(function(i) { if (!i.done) pending++; }); });
        var parts = [];
        parts.push(today ? 'Tienes ' + today + (today === 1 ? ' nota' : ' notas') + ' para hoy' : 'Nada agendado para hoy');
        if (pending) parts.push(pending + (pending === 1 ? ' pendiente' : ' pendientes'));
        $('k-summary').textContent = parts.join(' · ') + ' ✨';
    }

    // ---------- Tarjeta de nota ----------
    function noteCard(n) {
        var total = (n.checklist || []).length, done = (n.checklist || []).filter(function(i) { return i.done; }).length;
        var html = '<article class="k-note k-color-' + (n.color || 'pink') + '" data-id="' + n.id + '" tabindex="0">';
        html += '<div class="k-note-top">';
        if (n.sticker) html += '<span class="k-note-sticker">' + n.sticker + '</span>';
        html += '<div class="k-note-titles">' + (n.title ? '<h3>' + esc(n.title) + '</h3>' : '') +
            (n.date ? '<span class="k-date-chip">📅 ' + shortDate(n.date) + (n.time ? ' · ' + n.time : '') + '</span>' : '') + '</div>';
        if (n.pinned) html += '<span class="k-pin" title="Fijada">📌</span>';
        html += '</div>';
        if (n.body) html += '<p class="k-note-body">' + esc(n.body) + '</p>';
        if (total) {
            html += '<ul class="k-note-check">';
            n.checklist.slice(0, 4).forEach(function(i) {
                html += '<li class="' + (i.done ? 'done' : '') + '"><button class="k-check" data-item="' + i.id + '" aria-label="Marcar">' + (i.done ? '✓' : '') + '</button><span>' + esc(i.text) + '</span></li>';
            });
            if (total > 4) html += '<li class="k-more">+' + (total - 4) + ' más</li>';
            html += '</ul><div class="k-progress"><span style="width:' + Math.round(done / total * 100) + '%"></span></div>';
        }
        html += '<footer>' + (n.category ? '<span class="k-cat">' + catLabel(n.category) + '</span>' : '<span></span>') +
            '<span class="k-updated">' + shortDate(dateKey(new Date(n.updated))) + '</span></footer>';
        html += '</article>';
        return html;
    }

    function bindCards(container) {
        container.querySelectorAll('.k-note').forEach(function(el) {
            el.addEventListener('click', function(e) {
                var chk = e.target.closest('.k-check');
                var n = notes.find(function(x) { return x.id === el.getAttribute('data-id'); });
                if (!n) return;
                if (chk) { e.stopPropagation(); toggleItem(n, chk.getAttribute('data-item')); return; }
                openEditor(n);
            });
            el.addEventListener('keydown', function(e) { if (e.key === 'Enter') el.click(); });
        });
    }

    function toggleItem(n, itemId) {
        var it = (n.checklist || []).find(function(i) { return i.id === itemId; });
        if (!it) return;
        it.done = !it.done;
        changed(n); renderAll();
        if (it.done) UI.toast('✓ ¡Bien hecho! 💖');
    }

    function emptyState(icon, text, withButton) {
        return '<div class="k-empty"><div class="k-empty-icon">' + icon + '</div><p>' + text + '</p>' +
            (withButton ? '<button class="k-btn k-btn-primary" data-empty-add>＋ Nueva nota</button>' : '') + '</div>';
    }

    // ---------- Pestaña Notas ----------
    function renderChips() {
        var chips = [{ id: 'all', label: '🌸 Todas' }, { id: 'pinned', label: '📌 Fijadas' }].concat(CATEGORIES);
        $('k-chips').innerHTML = chips.map(function(c) {
            return '<button class="k-chip' + (filter === c.id ? ' active' : '') + '" data-f="' + c.id + '">' + c.label + '</button>';
        }).join('');
        $('k-chips').querySelectorAll('.k-chip').forEach(function(b) {
            b.addEventListener('click', function() { filter = b.getAttribute('data-f'); renderChips(); renderNotes(); });
        });
    }

    function renderNotes() {
        var list = sortNotes(notes.filter(matches));
        var c = $('k-notes');
        if (!list.length) {
            c.innerHTML = notes.length ? emptyState('🔍', 'No encontré notas con ese filtro') : emptyState('🎀', 'Tu agenda está vacía.<br>¡Escribe tu primera nota!', true);
        } else {
            c.innerHTML = '<div class="k-masonry">' + list.map(noteCard).join('') + '</div>';
            bindCards(c);
        }
        var eb = c.querySelector('[data-empty-add]'); if (eb) eb.addEventListener('click', function() { openEditor(null); });
    }

    // ---------- Pestaña Calendario ----------
    function renderCalendar() {
        $('k-cal-title').textContent = cap(MONTHS[calMonth.getMonth()]) + ' ' + calMonth.getFullYear();
        var first = (calMonth.getDay() + 6) % 7; // lunes = 0
        var daysIn = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
        var t = todayKey(), html = '';
        var counts = {};
        notes.forEach(function(n) { if (n.date) counts[n.date] = (counts[n.date] || 0) + 1; });
        for (var i = 0; i < first; i++) html += '<span class="k-cal-empty"></span>';
        for (var d = 1; d <= daysIn; d++) {
            var k = dateKey(new Date(calMonth.getFullYear(), calMonth.getMonth(), d));
            var cls = 'k-cal-day' + (k === t ? ' today' : '') + (k === selectedDay ? ' selected' : '') + (counts[k] ? ' has-notes' : '');
            html += '<button class="' + cls + '" data-day="' + k + '"><span class="k-cal-num">' + d + '</span>' +
                (counts[k] ? '<span class="k-cal-mark">' + (counts[k] > 1 ? '🎀<small>' + counts[k] + '</small>' : '🎀') + '</span>' : '') + '</button>';
        }
        $('k-cal-days').innerHTML = html;
        $('k-cal-days').querySelectorAll('.k-cal-day').forEach(function(b) {
            b.addEventListener('click', function() { selectedDay = b.getAttribute('data-day'); renderCalendar(); });
            b.addEventListener('dblclick', function() { openEditor(null, { date: b.getAttribute('data-day') }); });
        });
        $('k-day-title').textContent = cap(longDate(selectedDay));
        var dayNotes = notesOn(selectedDay);
        var dn = $('k-day-notes');
        if (!dayNotes.length) dn.innerHTML = emptyState('🌷', 'Sin notas este día');
        else { dn.innerHTML = '<div class="k-day-list">' + dayNotes.map(noteCard).join('') + '</div>'; bindCards(dn); }
    }

    // ---------- Pestaña Pendientes ----------
    function renderTodo() {
        var t = todayKey(), html = '';
        var upcoming = notes.filter(function(n) { return n.date && n.date >= t; })
            .sort(function(a, b) { return (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')); }).slice(0, 12);
        var overdue = notes.filter(function(n) { return n.date && n.date < t && (n.checklist || []).some(function(i) { return !i.done; }); });
        var withTasks = notes.filter(function(n) { return (n.checklist || []).some(function(i) { return !i.done; }); });

        if (overdue.length) {
            html += '<h3 class="k-subtitle">⏰ Atrasadas</h3><div class="k-list">' + overdue.map(function(n) {
                return '<button class="k-row k-row-warn" data-open="' + n.id + '"><span>' + (n.sticker || '📝') + '</span><span class="k-row-text">' + esc(n.title || 'Sin título') + '</span><span class="k-row-meta">' + shortDate(n.date) + '</span></button>';
            }).join('') + '</div>';
        }
        html += '<h3 class="k-subtitle">📅 Próximos</h3>';
        html += upcoming.length ? '<div class="k-list">' + upcoming.map(function(n) {
            return '<button class="k-row" data-open="' + n.id + '"><span>' + (n.sticker || '📝') + '</span><span class="k-row-text">' + esc(n.title || n.body.slice(0, 40) || 'Sin título') + '</span><span class="k-row-meta">' + shortDate(n.date) + (n.time ? ' · ' + n.time : '') + '</span></button>';
        }).join('') + '</div>' : '<p class="k-muted">No hay fechas próximas 🌷</p>';

        html += '<h3 class="k-subtitle">✅ Tareas por hacer</h3>';
        if (!withTasks.length) html += '<p class="k-muted">¡Todo listo! No tienes tareas pendientes 🎉</p>';
        withTasks.forEach(function(n) {
            html += '<div class="k-task-group k-color-' + (n.color || 'pink') + '"><button class="k-task-title" data-open="' + n.id + '">' + (n.sticker || '📝') + ' ' + esc(n.title || 'Sin título') + '</button><ul class="k-note-check">';
            n.checklist.forEach(function(i) {
                if (!i.done) html += '<li><button class="k-check" data-note="' + n.id + '" data-item="' + i.id + '" aria-label="Marcar"></button><span>' + esc(i.text) + '</span></li>';
            });
            html += '</ul></div>';
        });
        var c = $('k-todo');
        c.innerHTML = html;
        c.querySelectorAll('[data-open]').forEach(function(b) {
            b.addEventListener('click', function() { openEditor(notes.find(function(n) { return n.id === b.getAttribute('data-open'); })); });
        });
        c.querySelectorAll('.k-check').forEach(function(b) {
            b.addEventListener('click', function() { toggleItem(notes.find(function(n) { return n.id === b.getAttribute('data-note'); }), b.getAttribute('data-item')); });
        });
    }

    function renderAll() {
        renderHero();
        if (tab === 'notes') renderNotes();
        else if (tab === 'calendar') renderCalendar();
        else renderTodo();
    }

    function setTab(t) {
        tab = t;
        document.querySelectorAll('.k-tab').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-tab') === t); });
        ['notes', 'calendar', 'todo'].forEach(function(p) { $('k-panel-' + p).classList.toggle('hidden', p !== t); });
        renderAll();
    }

    // ---------- Editor de nota ----------
    var editorOpen = false;

    function openEditor(note, preset) {
        if (editorOpen) return;
        editorOpen = true;
        var isNew = !note;
        var draft = JSON.parse(JSON.stringify(note || {
            id: UI.newId('note'), title: '', body: '', color: 'pink', category: 'personal', sticker: '🎀',
            date: null, time: '', pinned: false, checklist: [], created: Date.now(), updated: Date.now()
        }));
        if (preset) Object.keys(preset).forEach(function(k) { draft[k] = preset[k]; });
        var original = JSON.stringify(draft);

        var ov = document.createElement('div');
        ov.className = 'k-editor-overlay kawaii';
        ov.innerHTML =
            '<div class="k-editor k-color-' + draft.color + '" role="dialog" aria-modal="true">' +
            '  <header class="k-editor-head">' +
            '    <button class="k-icon-btn" data-close title="Cerrar">✕</button>' +
            '    <span class="k-editor-heading">' + (isNew ? 'Nueva nota' : 'Editar nota') + '</span>' +
            '    <button class="k-icon-btn" data-pin title="Fijar">📌</button>' +
            '    <button class="k-btn k-btn-primary" data-save>💖 Guardar</button>' +
            '  </header>' +
            '  <div class="k-editor-body">' +
            '    <div class="k-sticker-row" data-stickers></div>' +
            '    <input class="k-input-title" data-title placeholder="Título" maxlength="120">' +
            '    <textarea class="k-input-body" data-body placeholder="Escribe aquí lo que quieras recordar... ✏️"></textarea>' +
            '    <div class="k-field"><label>✅ Lista de tareas</label><ul class="k-edit-list" data-list></ul>' +
            '      <div class="k-add-item"><input data-new-item placeholder="Añadir tarea..." enterkeyhint="done"><button class="k-btn k-btn-small" data-add-item>＋</button></div></div>' +
            '    <div class="k-field k-field-row">' +
            '      <div><label>📅 Fecha</label><input type="date" data-date></div>' +
            '      <div><label>⏰ Hora</label><input type="time" data-time></div>' +
            '      <button class="k-link" data-clear-date>Quitar fecha</button>' +
            '    </div>' +
            '    <div class="k-field"><label>🏷️ Categoría</label><div class="k-chips k-chips-wrap" data-cats></div></div>' +
            '    <div class="k-field"><label>🎨 Color</label><div class="k-swatches" data-colors></div></div>' +
            (isNew ? '' : '    <button class="k-btn k-btn-danger" data-delete>🗑️ Eliminar nota</button>') +
            '  </div>' +
            '</div>';
        document.body.appendChild(ov);

        var box = ov.querySelector('.k-editor');
        var q = function(sel) { return ov.querySelector(sel); };
        q('[data-title]').value = draft.title;
        q('[data-body]').value = draft.body;
        q('[data-date]').value = draft.date || '';
        q('[data-time]').value = draft.time || '';

        function paintSticker() {
            q('[data-stickers]').innerHTML = STICKERS.map(function(s) {
                return '<button class="k-sticker' + (draft.sticker === s ? ' active' : '') + '" data-s="' + s + '">' + s + '</button>';
            }).join('');
            q('[data-stickers]').querySelectorAll('.k-sticker').forEach(function(b) {
                b.addEventListener('click', function() { draft.sticker = draft.sticker === b.getAttribute('data-s') ? '' : b.getAttribute('data-s'); paintSticker(); });
            });
        }
        function paintPin() { q('[data-pin]').classList.toggle('active', !!draft.pinned); }
        function paintCats() {
            q('[data-cats]').innerHTML = CATEGORIES.map(function(c) {
                return '<button class="k-chip' + (draft.category === c.id ? ' active' : '') + '" data-c="' + c.id + '">' + c.label + '</button>';
            }).join('');
            q('[data-cats]').querySelectorAll('.k-chip').forEach(function(b) {
                b.addEventListener('click', function() { draft.category = draft.category === b.getAttribute('data-c') ? '' : b.getAttribute('data-c'); paintCats(); });
            });
        }
        function paintColors() {
            q('[data-colors]').innerHTML = COLORS.map(function(c) {
                return '<button class="k-swatch k-color-' + c.id + (draft.color === c.id ? ' active' : '') + '" data-col="' + c.id + '" title="' + c.label + '"></button>';
            }).join('');
            q('[data-colors]').querySelectorAll('.k-swatch').forEach(function(b) {
                b.addEventListener('click', function() {
                    box.classList.remove('k-color-' + draft.color);
                    draft.color = b.getAttribute('data-col');
                    box.classList.add('k-color-' + draft.color);
                    paintColors();
                });
            });
        }
        function paintList() {
            var ul = q('[data-list]');
            ul.innerHTML = (draft.checklist || []).map(function(i) {
                return '<li class="' + (i.done ? 'done' : '') + '" data-id="' + i.id + '"><button class="k-check" data-toggle>' + (i.done ? '✓' : '') + '</button>' +
                    '<input value="' + esc(i.text) + '" data-text><button class="k-icon-btn k-icon-small" data-remove title="Quitar">✕</button></li>';
            }).join('');
            ul.querySelectorAll('li').forEach(function(li) {
                var item = draft.checklist.find(function(i) { return i.id === li.getAttribute('data-id'); });
                li.querySelector('[data-toggle]').addEventListener('click', function() { item.done = !item.done; paintList(); });
                li.querySelector('[data-text]').addEventListener('input', function(e) { item.text = e.target.value; });
                li.querySelector('[data-remove]').addEventListener('click', function() { draft.checklist = draft.checklist.filter(function(i) { return i !== item; }); paintList(); });
            });
        }
        function addItem() {
            var inp = q('[data-new-item]'), v = inp.value.trim();
            if (!v) return;
            draft.checklist = draft.checklist || [];
            draft.checklist.push({ id: UI.newId('it'), text: v, done: false });
            inp.value = ''; paintList(); inp.focus();
        }
        function autoGrow() { var t = q('[data-body]'); t.style.height = 'auto'; t.style.height = Math.max(120, t.scrollHeight) + 'px'; }

        paintSticker(); paintPin(); paintCats(); paintColors(); paintList();
        setTimeout(autoGrow, 0);

        function collect() {
            draft.title = q('[data-title]').value.trim();
            draft.body = q('[data-body]').value;
            draft.date = q('[data-date]').value || null;
            draft.time = draft.date ? q('[data-time]').value : '';
            draft.checklist = (draft.checklist || []).filter(function(i) { return i.text.trim(); });
        }
        function close() { popLayer(); editorOpen = false; ov.classList.add('closing'); setTimeout(function() { ov.remove(); }, 180); }
        async function tryClose() {
            collect();
            if (JSON.stringify(draft) !== original && (draft.title || draft.body.trim() || draft.checklist.length)) {
                var r = await UI.choice('¿Guardar los cambios?', [{ label: '💖 Guardar', value: 'save', primary: true }, { label: 'Descartar', value: 'discard', danger: true }]);
                if (r === 'save') return doSave();
                if (r !== 'discard') return;
            }
            close();
        }
        function doSave() {
            collect();
            if (!draft.title && !draft.body.trim() && !draft.checklist.length) { UI.toast('La nota está vacía 🙈', 'info'); return; }
            draft.updated = Date.now();
            draft._dirty = true;
            var i = notes.findIndex(function(n) { return n.id === draft.id; });
            if (i === -1) notes.push(draft); else notes[i] = draft;
            if (draft.date) { selectedDay = draft.date; calMonth = startOfMonth(parseKey(draft.date)); }
            changed(null); renderAll(); close();
            UI.toast(isNew ? '🎀 Nota guardada' : '💖 Nota actualizada');
        }
        var popLayer = UI.pushLayer(tryClose);

        q('[data-close]').addEventListener('click', tryClose);
        q('[data-save]').addEventListener('click', doSave);
        q('[data-pin]').addEventListener('click', function() { draft.pinned = !draft.pinned; paintPin(); });
        q('[data-add-item]').addEventListener('click', addItem);
        q('[data-new-item]').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
        q('[data-body]').addEventListener('input', autoGrow);
        q('[data-clear-date]').addEventListener('click', function() { q('[data-date]').value = ''; q('[data-time]').value = ''; });
        ov.addEventListener('click', function(e) { if (e.target === ov) tryClose(); });
        box.addEventListener('keydown', function(e) { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSave(); } });
        var del = q('[data-delete]');
        if (del) del.addEventListener('click', async function() {
            if (!(await UI.confirm('Esta nota se borrará para siempre.', { title: '¿Eliminar nota?', okText: 'Eliminar', danger: true }))) return;
            notes = notes.filter(function(n) { return n.id !== draft.id; });
            Data.addTombstone('agenda_notes', draft.id).then(function() { Sync.schedule(); });
            save(); renderAll(); close();
            UI.toast('🗑️ Nota eliminada', 'info');
        });
        if (isNew && !preset) setTimeout(function() { q('[data-title]').focus(); }, 80);
    }

    // ---------- Inicio ----------
    function init() {
        $('k-new-note').addEventListener('click', function() {
            openEditor(null, tab === 'calendar' ? { date: selectedDay } : null);
        });
        $('k-day-add').addEventListener('click', function() { openEditor(null, { date: selectedDay }); });
        document.querySelectorAll('.k-tab').forEach(function(b) { b.addEventListener('click', function() { setTab(b.getAttribute('data-tab')); }); });
        var st = null;
        $('k-search').addEventListener('input', function(e) {
            clearTimeout(st);
            st = setTimeout(function() { query = e.target.value.trim().toLowerCase(); if (query && tab !== 'notes') setTab('notes'); else renderNotes(); }, 150);
        });
        $('k-cal-prev').addEventListener('click', function() { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
        $('k-cal-next').addEventListener('click', function() { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });
        $('k-cal-today').addEventListener('click', function() { calMonth = startOfMonth(new Date()); selectedDay = todayKey(); renderCalendar(); });
        $('k-greeting').addEventListener('click', async function() {
            var n = await UI.prompt('¿Cómo te llamas? 🎀', localStorage.getItem(NAME_KEY) || '', { placeholder: 'Tu nombre' });
            if (n === null) return;
            if (n.trim()) localStorage.setItem(NAME_KEY, n.trim()); else localStorage.removeItem(NAME_KEY);
            renderHero();
        });
        renderChips();
        Sync.register({
            table: 'agenda_notes',
            list: function() { return notes; },
            stamp: function(n) { return n.updated || 0; },
            isDirty: function(n) { return !!n._dirty || !n._syncedAt; },
            toData: clean,
            markClean: function(items) {
                var now = Date.now();
                items.forEach(function(it) { var n = notes.find(function(x) { return x.id === it.id; }); if (n && n.updated === it.stamp) { n._dirty = false; n._syncedAt = now; } });
                return save();
            },
            resetMarks: function() { notes.forEach(function(n) { n._syncedAt = null; }); return save(); },
            applyRemote: function(rows) {
                var now = Date.now(), any = false;
                rows.forEach(function(row) {
                    var i = notes.findIndex(function(x) { return x.id === row.id; }), local = notes[i], stamp = +row.client_updated_at || 0;
                    if (row.deleted) {
                        if (local && !(local._dirty && (local.updated || 0) > stamp)) { notes.splice(i, 1); any = true; }
                        return;
                    }
                    var data = Object.assign({}, row.data, { id: row.id, updated: stamp, _dirty: false, _syncedAt: now });
                    if (!local) { notes.push(data); any = true; }
                    else if (stamp > (local.updated || 0)) { notes[i] = data; any = true; }
                    else if (stamp === local.updated) { local._dirty = false; local._syncedAt = local._syncedAt || now; }
                });
                return save().then(function() { if (any && !document.querySelector('.k-editor-overlay')) renderAll(); });
            }
        });
        return localforage.getItem(STORE_KEY).then(function(v) { notes = v || []; renderAll(); });
    }

    return {
        init: init,
        refresh: renderAll,
        getNotes: function() { return notes; },
        setNotes: function(list) { notes = list || []; return save().then(renderAll); },
        // Importa notas de un respaldo: 'merge' conserva la versión más reciente; 'replace' deja solo las del respaldo
        importNotes: async function(list, mode) {
            list = (list || []).map(function(n) { var c = clean(n); c._dirty = true; return c; });
            if (mode === 'replace') {
                var keep = list.map(function(n) { return n.id; });
                for (var i = 0; i < notes.length; i++) if (keep.indexOf(notes[i].id) === -1) await Data.addTombstone('agenda_notes', notes[i].id);
                notes = list;
            } else {
                list.forEach(function(n) {
                    var i = notes.findIndex(function(x) { return x.id === n.id; });
                    if (i === -1) notes.push(n); else if ((n.updated || 0) > (notes[i].updated || 0)) notes[i] = n;
                });
            }
            await save();
            Sync.schedule();
            renderAll();
        }
    };
})();
