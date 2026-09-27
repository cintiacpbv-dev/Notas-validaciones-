# 🐶🎀 Mis Notas — Validaciones y Agenda

App para **validar documentos PDF** con anotaciones (notas, fotos, videos, audios, tiempos y reemplazos de texto) y una **agenda personal de notas** con estilo kawaii (rosa, moños y lunares), inspirada en Hello Kitty.

Funciona en **celular, tablet y PC**, y sin conexión a internet.

## 📱 Instalar en Android (APK)

1. Entra a la pestaña **Releases** del repositorio y abre la versión más reciente.
2. En *Assets* descarga `MisNotas-1.0.X.apk`.
3. Ábrelo en tu celular o tablet. Si Android lo pide, permite **"Instalar apps de origen desconocido"**.

El APK se compila automáticamente con GitHub Actions (`.github/workflows/android-apk.yml`) en cada cambio a `web/` o `android/`. También puedes lanzarlo a mano desde **Actions → Compilar APK → Run workflow**.

## 💻 Usar en PC

- Descarga el repositorio y abre `web/index.html` en Chrome o Edge, **o**
- Publica la carpeta `web/` en cualquier hosting (por ejemplo GitHub Pages) y ábrela desde el navegador; se puede "instalar" como app (PWA).

> Los datos se guardan en el dispositivo/navegador donde uses la app. Para pasarlos de un dispositivo a otro usa **📤 Exportar** e **📥 Importar** (el respaldo `.zip` incluye proyectos, multimedia y la agenda).

## ✨ Qué incluye

**Validaciones (PDF)**
- Diseño adaptable: barra inferior en celular, riel lateral en tablet y PC.
- Zoom con pellizco, botones, Ctrl+rueda, doble toque y botón **↔️ ajustar al ancho**; se reajusta al girar la pantalla.
- Notas: arrastra 📝 al documento o tócalo para ponerla en el centro visible.
- Foto (cámara o galería), video, audio, cronómetro y reemplazo de texto seleccionado.
- En celular las notas se abren como panel inferior para que nunca se salgan de la pantalla.
- Buscador de proyectos, atajos de teclado en PC (← →, Ctrl + / Ctrl −, Esc).

**Mi Agenda 🎀**
- Notas tipo post‑it con colores pastel, stickers, categorías y notas fijadas 📌.
- Listas de tareas con progreso.
- Calendario mensual con moños en los días que tienen notas.
- Pestaña de pendientes: próximas fechas, tareas atrasadas y por hacer.
- Buscador, saludo personalizado (toca el saludo para poner tu nombre) y modo oscuro.

## 🗂️ Estructura

```
web/                 App web (se empaqueta tal cual dentro del APK)
  index.html
  css/ app.css, agenda.css
  js/  ui.js, validaciones.js, agenda.js, app.js
  vendor/            pdf.js, localforage y JSZip (sin depender de internet)
  icons/schnauzer.svg  Icono original del Schnauzer
android/             Proyecto Android (WebView nativo)
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
