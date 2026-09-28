# 🐶🎀 Mis Notas — Validaciones y Agenda

App para **validar documentos PDF** con anotaciones (notas, fotos, videos, audios, tiempos y reemplazos de texto) y una **agenda personal de notas** con estilo kawaii (rosa, moños y lunares), inspirada en Hello Kitty.

Funciona en **celular, tablet y PC**, y sin conexión a internet.

## 📱 Instalar en Android (APK)

1. Entra a la pestaña **Releases** del repositorio y abre la versión más reciente.
2. En *Assets* descarga `MisNotas-1.0.X.apk`.
3. Ábrelo en tu celular o tablet. Si Android lo pide, permite **"Instalar apps de origen desconocido"**.

El APK se compila automáticamente con GitHub Actions (`.github/workflows/android-apk.yml`) en cada cambio a `web/` o `android/`. También puedes lanzarlo a mano desde **Actions → Compilar APK → Run workflow**.

## ▲ Desplegar en Vercel

1. En [vercel.com](https://vercel.com) → **Add New… → Project** e importa este repositorio de GitHub.
2. Deja **Framework Preset: Other**. El archivo `vercel.json` ya indica todo: publica la carpeta `web/` y ejecuta `node tools/build-config.js`.
3. En **Settings → Environment Variables** agrega (para Production y Preview):
   - `SUPABASE_URL` = la Project URL de Supabase
   - `SUPABASE_ANON_KEY` = la anon public key
4. **Deploy.** Cada push a la rama vuelve a publicar la página.
5. En Supabase → **Authentication → URL Configuration**, pon tu dominio de Vercel en **Site URL** (y en *Redirect URLs*) para que los correos de confirmación regresen a tu página.

Para probar en tu PC con las mismas variables, crea `.env.local` (no se sube a GitHub) con esos dos valores y ejecuta `node tools/build-config.js`; luego sirve la carpeta `web/`, por ejemplo con `npx serve web`.

## 💻 Usar en PC

- Descarga el repositorio y abre `web/index.html` en Chrome o Edge, **o**
- Publica la carpeta `web/` en cualquier hosting (por ejemplo GitHub Pages) y ábrela desde el navegador; se puede "instalar" como app (PWA).

> Los datos se guardan en el dispositivo o navegador donde uses la app, y opcionalmente en tu Supabase (ver abajo).

## ✨ Qué incluye

**Validaciones (revisión de PDF)**
- Panel de proyectos con avance (resueltas/pendientes), búsqueda, filtros y orden. En PC se puede arrastrar un PDF para crear un proyecto.
- Editor con barra de herramientas: **Mover, Nota, Tachar, Foto, Video, Audio y Tiempo**. Puedes elegir la herramienta y tocar el punto del documento, **o arrastrar el botón** hasta el lugar exacto.
- Tocar cualquier marcador abre su detalle en el panel; fotos y videos se ven en **pantalla completa** (con zoom en fotos).
- La numeración de observaciones se mantiene continua (#1, #2, #3…) aunque borres alguna.
- **Tachar y reemplazar:** selecciona texto del PDF y pulsa el botón flotante.
- Panel de **observaciones** numeradas (#1, #2…) agrupadas por página, con estado **Pendiente / Resuelta**, filtros por estado y tipo, y botón "Siguiente pendiente".
- Zoom con pellizco que sigue tus dedos (acercar y desplazarte al mismo tiempo, sin esperar), botones, Ctrl + rueda, doble toque y ajustar al ancho.
- Atajos en PC: `V` mover, `N` nota, `T` tachar, `F` foto, `G` video, `A` audio, `C` tiempo, `←/→` páginas, `Supr` borrar, `Esc` cerrar.
- Iconos propios y tipografía IBM Plex; temas **claro, oscuro, rosa** o automático.

**Compartir**
- Resumen de observaciones por **WhatsApp** (con número opcional) o cualquier otra app.
- Cada foto, video o audio se puede enviar por WhatsApp, redes sociales u otras apps, o guardar en el dispositivo.
- **Exportar proyecto (.json)** para abrirlo en otro equipo, con PDF y multimedia opcionales. Se abre con **Importar**.
- Respaldo completo (.zip) de todo: proyectos, PDF, multimedia y agenda.

**Mi Agenda 🎀**
- Notas tipo post‑it con colores, stickers, categorías, fijadas, listas de tareas, calendario y pendientes.

## ☁️ Guardado local + Supabase

- Todo se guarda **siempre en el dispositivo** y funciona sin internet.
- Si conectas **Supabase**, se sincronizan entre tus dispositivos:
  - los proyectos (observaciones, estados, textos) y la agenda;
  - los **documentos PDF** de cada proyecto (en un espacio privado de Supabase Storage; solo tu cuenta puede verlos). En otro dispositivo el PDF se descarga al abrir el proyecto, o en segundo plano si hay wifi, y queda guardado para usarlo sin internet. Si reemplazas el PDF, los demás equipos reciben la nueva versión.
- Las **fotos, videos y audios NO se suben** por su peso: se quedan en el dispositivo donde se capturaron (en los otros equipos aparece "Guardado en otro dispositivo"). Para pasarlos usa **Compartir** (WhatsApp, redes, etc.) o **Exportar proyecto (.json)** con multimedia.
- Límite por PDF: 50 MB (plan gratuito de Supabase). Si un PDF es más grande, se queda solo en el dispositivo y la app te avisa.

### Conectar Supabase (una sola vez)

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor → New query**, pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**. Crea las tablas, el espacio privado `documentos` para los PDF y las reglas de seguridad (cada usuario solo ve sus datos). Si ya lo habías ejecutado antes, vuelve a ejecutarlo para agregar el espacio de PDF (no borra nada).
3. En **Project Settings → API** copia la **Project URL** y la **anon public key**.
4. La app ya viene conectada a este proyecto (valores en `web/js/config.js`), así que no hay que pegar la URL ni la clave. Si quisieras usar otro proyecto: **Validaciones → botón de nube → Cambiar**.
5. Crea tu cuenta con correo y contraseña (o inicia sesión). Si Supabase pide confirmar el correo, confírmalo y vuelve a iniciar sesión.
6. Repite el inicio de sesión en tus otros dispositivos con la misma cuenta.

> Opcional: si escribes la URL y la clave en [`web/js/config.js`](web/js/config.js), todos los dispositivos quedarán conectados automáticamente y solo tendrás que iniciar sesión. La *anon key* es pública por diseño; la seguridad la dan las reglas del `schema.sql`.

## 🗂️ Estructura

```
web/                 App web (se empaqueta tal cual dentro del APK)
  index.html
  css/ app.css, validaciones.css, agenda.css
  js/  icons.js (iconos propios), ui.js, store.js (datos locales), sync.js (Supabase),
       share.js (compartir/exportar), validaciones.js, agenda.js, app.js, config.js
  vendor/            pdf.js, localforage y JSZip (sin depender de internet)
  icons/schnauzer.svg  Icono original del Schnauzer
android/             Proyecto Android (WebView nativo)
supabase/schema.sql  Tablas, almacenamiento de PDF y reglas de seguridad para Supabase
tools/gen-icons.js   Regenera los PNG del icono desde el SVG
```

## 🔐 Firma del APK

Para que las actualizaciones se instalen encima de la versión anterior, todos los APK se firman con la misma llave: `android/keystore/misnotas.jks`.
Si prefieres una llave privada, crea estos *secrets* en **Settings → Secrets and variables → Actions** y el workflow los usará automáticamente:
`KEYSTORE_BASE64` (el .jks en base64), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
(Al cambiar de llave hay que desinstalar la versión anterior una vez.)

## 🛠️ Compilar localmente

Requiere JDK 17 y Android SDK:

```bash
cd android
./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```
