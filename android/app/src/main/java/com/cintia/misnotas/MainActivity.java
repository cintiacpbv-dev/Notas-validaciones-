package com.cintia.misnotas;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Contenedor nativo de la app web (carpeta /web). La web se sirve desde
 * https://appassets.androidplatform.net para que IndexedDB, la cámara y el
 * micrófono funcionen como en un sitio seguro.
 */
public class MainActivity extends ComponentActivity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";
    private static final int PURPOSE_WEB_PERMISSION = 1;
    private static final int PURPOSE_CAMERA_CAPTURE = 2;

    private FrameLayout root;
    private WebView webView;
    private WebViewAssetLoader assetLoader;

    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;
    private PermissionRequest pendingWebPermission;
    private int permissionPurpose;
    private boolean captureVideo;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private ActivityResultLauncher<String[]> permissionLauncher;

    private final Map<String, File> exportFiles = new HashMap<>();
    private final Map<String, OutputStream> exportStreams = new HashMap<>();
    private final Map<String, String> exportMimes = new HashMap<>();
    private final Map<String, File> readyFiles = new HashMap<>();
    private final Map<String, String> readyMimes = new HashMap<>();
    private static final String[] WHATSAPP = {"com.whatsapp", "com.whatsapp.w4b"};

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        fileChooserLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::onFileChosen);
        permissionLauncher = registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), this::onPermissionsResult);

        // Pantalla de borde a borde: el contenido se separa de las barras del sistema con padding.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#FFF4F8"));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        setDarkBars(false);

        configureWebView();
        cleanOldCache();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (customView != null) { hideCustomView(); return; }
                webView.evaluateJavascript(
                        "(function(){try{return !!(window.onAndroidBack && window.onAndroidBack());}catch(e){return false;}})()",
                        value -> {
                            if (!"true".equals(value)) moveTaskToBack(true);
                        });
            }
        });
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }
        });
        webView.setWebChromeClient(new ChromeClient());
        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
    }

    // ------------------------------------------------------------------
    // Permisos de cámara y micrófono pedidos por la web (getUserMedia)
    // ------------------------------------------------------------------
    private class ChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(() -> {
                List<String> needed = new ArrayList<>();
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !has(Manifest.permission.CAMERA)) {
                        needed.add(Manifest.permission.CAMERA);
                    } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !has(Manifest.permission.RECORD_AUDIO)) {
                        needed.add(Manifest.permission.RECORD_AUDIO);
                    }
                }
                if (needed.isEmpty()) {
                    grantAllowed(request);
                } else {
                    pendingWebPermission = request;
                    permissionPurpose = PURPOSE_WEB_PERMISSION;
                    permissionLauncher.launch(needed.toArray(new String[0]));
                }
            });
        }

        // Pantalla completa nativa del reproductor de video
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) { callback.onCustomViewHidden(); return; }
            customView = view;
            customViewCallback = callback;
            view.setBackgroundColor(Color.BLACK);
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            webView.setVisibility(View.GONE);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingWebPermission == request) pendingWebPermission = null;
        }

        // Selector de archivos para <input type="file"> (PDF, fotos, respaldo .zip)
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;

            String[] accept = params.getAcceptTypes();
            boolean wantsImages = false, wantsVideo = false;
            for (String a : accept) {
                if (a == null) continue;
                if (a.contains("image")) wantsImages = true;
                if (a.contains("video")) wantsVideo = true;
            }
            if (params.isCaptureEnabled() && (wantsImages || wantsVideo)) {
                captureVideo = wantsVideo && !wantsImages;
                if (has(Manifest.permission.CAMERA)) {
                    launchCamera();
                } else {
                    permissionPurpose = PURPOSE_CAMERA_CAPTURE;
                    permissionLauncher.launch(new String[]{Manifest.permission.CAMERA});
                }
            } else {
                launchPicker(accept, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            }
            return true;
        }
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        webView.setVisibility(View.VISIBLE);
        WindowCompat.getInsetsController(getWindow(), root).show(WindowInsetsCompat.Type.systemBars());
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    private boolean has(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void grantAllowed(PermissionRequest request) {
        List<String> allowed = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && has(Manifest.permission.CAMERA)) allowed.add(r);
            else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && has(Manifest.permission.RECORD_AUDIO)) allowed.add(r);
        }
        if (allowed.isEmpty()) request.deny();
        else request.grant(allowed.toArray(new String[0]));
    }

    private void onPermissionsResult(Map<String, Boolean> result) {
        if (permissionPurpose == PURPOSE_WEB_PERMISSION && pendingWebPermission != null) {
            grantAllowed(pendingWebPermission);
            pendingWebPermission = null;
        } else if (permissionPurpose == PURPOSE_CAMERA_CAPTURE && filePathCallback != null) {
            if (has(Manifest.permission.CAMERA)) {
                launchCamera();
            } else {
                Toast.makeText(this, "Se necesita permiso de cámara", Toast.LENGTH_SHORT).show();
                filePathCallback.onReceiveValue(null);
                filePathCallback = null;
            }
        }
        permissionPurpose = 0;
    }

    private void launchCamera() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists()) dir.mkdirs();
            File out = new File(dir, (captureVideo ? "VID_" : "IMG_") + System.currentTimeMillis() + (captureVideo ? ".mp4" : ".jpg"));
            cameraOutputUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", out);
            Intent intent = new Intent(captureVideo ? MediaStore.ACTION_VIDEO_CAPTURE : MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            if (captureVideo) intent.putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            fileChooserLauncher.launch(intent);
        } catch (ActivityNotFoundException e) {
            cameraOutputUri = null;
            launchPicker(new String[]{captureVideo ? "video/*" : "image/*"}, false);
        }
    }

    private void launchPicker(String[] accept, boolean multiple) {
        cameraOutputUri = null;
        List<String> mimes = new ArrayList<>();
        boolean anyType = false;
        for (String raw : accept) {
            if (raw == null) continue;
            for (String a : raw.split(",")) {
                a = a.trim();
                if (a.isEmpty()) continue;
                // Los .zip tienen tipos MIME muy variados según el explorador: no filtramos.
                if (a.startsWith(".") || a.contains("zip")) anyType = true;
                else mimes.add(a);
            }
        }
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        if (anyType || mimes.isEmpty()) {
            intent.setType("*/*");
        } else if (mimes.size() == 1) {
            intent.setType(mimes.get(0));
        } else {
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
        if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            fileChooserLauncher.launch(Intent.createChooser(intent, "Seleccionar archivo"));
        } catch (ActivityNotFoundException e) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
    }

    private void onFileChosen(ActivityResult result) {
        if (filePathCallback == null) return;
        Uri[] uris = null;
        if (result.getResultCode() == Activity.RESULT_OK) {
            Intent data = result.getData();
            if (data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                uris = new Uri[n];
                for (int i = 0; i < n; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                uris = new Uri[]{data.getData()};
            } else if (cameraOutputUri != null) {
                uris = new Uri[]{cameraOutputUri};
            }
        }
        filePathCallback.onReceiveValue(uris);
        filePathCallback = null;
        cameraOutputUri = null;
    }

    // ------------------------------------------------------------------
    // Barras del sistema acordes al tema de la app
    // ------------------------------------------------------------------
    private void setDarkBars(boolean dark) {
        root.setBackgroundColor(Color.parseColor(dark ? "#0F172A" : "#FFF4F8"));
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
        c.setAppearanceLightStatusBars(!dark);
        c.setAppearanceLightNavigationBars(!dark);
    }

    // ------------------------------------------------------------------
    // Puente JavaScript: exportar archivos (respaldo .zip) desde la web
    // ------------------------------------------------------------------
    private class Bridge {
        @JavascriptInterface
        public String beginFile(String name, String mime) {
            try {
                File dir = new File(getCacheDir(), "exports");
                if (!dir.exists()) dir.mkdirs();
                String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
                File f = new File(dir, safe);
                String id = String.valueOf(System.nanoTime());
                synchronized (exportFiles) {
                    exportFiles.put(id, f);
                    exportStreams.put(id, new FileOutputStream(f));
                    exportMimes.put(id, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                }
                return id;
            } catch (IOException e) {
                return "";
            }
        }

        @JavascriptInterface
        public void appendChunk(String id, String base64) {
            OutputStream out;
            synchronized (exportFiles) {
                out = exportStreams.get(id);
            }
            if (out == null) return;
            try {
                out.write(Base64.decode(base64, Base64.DEFAULT));
            } catch (IOException ignored) {
            }
        }

        @JavascriptInterface
        public String finishFile(String id) {
            File f;
            OutputStream out;
            String mime;
            synchronized (exportFiles) {
                f = exportFiles.remove(id);
                out = exportStreams.remove(id);
                mime = exportMimes.remove(id);
            }
            if (f == null || out == null) return "";
            try {
                out.close();
            } catch (IOException ignored) {
            }
            String savedWhere = MainActivity.this.saveToDownloads(f, mime) ? "Descargas" : "";
            final File file = f;
            final String type = mime;
            runOnUiThread(() -> shareFile(file, type));
            return savedWhere;
        }

        // Cierra el archivo recibido por partes y lo deja listo para compartir o guardar.
        @JavascriptInterface
        public void endFile(String id) {
            synchronized (exportFiles) {
                File f = exportFiles.remove(id);
                OutputStream out = exportStreams.remove(id);
                String mime = exportMimes.remove(id);
                if (out != null) {
                    try { out.close(); } catch (IOException ignored) { }
                }
                if (f != null) {
                    readyFiles.put(id, f);
                    readyMimes.put(id, mime);
                }
            }
        }

        @JavascriptInterface
        public String saveToDownloads(String id) {
            File f;
            String mime;
            synchronized (exportFiles) {
                f = readyFiles.get(id);
                mime = readyMimes.get(id);
            }
            if (f == null) return "";
            return MainActivity.this.saveToDownloads(f, mime) ? "Descargas" : "";
        }

        // Comparte uno o varios archivos. target = "whatsapp" intenta abrir WhatsApp directamente.
        @JavascriptInterface
        public String shareFiles(String idsCsv, String text, String target) {
            final ArrayList<Uri> uris = new ArrayList<>();
            final List<String> mimes = new ArrayList<>();
            synchronized (exportFiles) {
                for (String id : idsCsv.split(",")) {
                    File f = readyFiles.get(id.trim());
                    if (f == null) continue;
                    uris.add(FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", f));
                    mimes.add(readyMimes.get(id.trim()));
                }
            }
            if (uris.isEmpty()) return "error";
            final Intent send = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
            send.setType(commonMime(mimes));
            if (uris.size() == 1) send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            ClipData clip = ClipData.newRawUri("", uris.get(0));
            for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
            send.setClipData(clip);
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return startShare(send, target);
        }

        @JavascriptInterface
        public String shareText(String text, String target) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            return startShare(send, target);
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, "No hay una app para abrir el enlace", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void setDarkBars(final boolean dark) {
            runOnUiThread(() -> MainActivity.this.setDarkBars(dark));
        }
    }

    private boolean saveToDownloads(File f, String mime) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, f.getName());
        values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) return false;
        try (InputStream in = new FileInputStream(f); OutputStream out = getContentResolver().openOutputStream(uri)) {
            if (out == null) return false;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return true;
        } catch (IOException e) {
            getContentResolver().delete(uri, null, null);
            return false;
        }
    }

    private String startShare(final Intent send, String target) {
        String pkg = null;
        if ("whatsapp".equals(target)) {
            for (String p : WHATSAPP) {
                if (isInstalled(p)) { pkg = p; break; }
            }
        }
        final String chosen = pkg;
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (chosen != null) {
                    Intent direct = new Intent(send);
                    direct.setPackage(chosen);
                    startActivity(direct);
                } else {
                    startActivity(Intent.createChooser(send, "Compartir con"));
                }
            } catch (ActivityNotFoundException e) {
                try {
                    startActivity(Intent.createChooser(send, "Compartir con"));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "No se pudo compartir", Toast.LENGTH_SHORT).show();
                }
            }
        });
        return "whatsapp".equals(target) && chosen == null ? "fallback" : "ok";
    }

    private boolean isInstalled(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private static String commonMime(List<String> mimes) {
        String first = mimes.get(0) == null ? "*/*" : mimes.get(0);
        boolean same = true, sameTop = true;
        String top = first.split("/")[0];
        for (String m : mimes) {
            if (m == null) m = "*/*";
            if (!m.equals(first)) same = false;
            if (!m.split("/")[0].equals(top)) sameTop = false;
        }
        if (same) return first;
        return sameTop ? top + "/*" : "*/*";
    }

    // Borra archivos temporales de más de 2 días (fotos de cámara ya importadas, exportaciones)
    private void cleanOldCache() {
        new Thread(() -> {
            long limit = System.currentTimeMillis() - 2L * 24 * 60 * 60 * 1000;
            for (String name : new String[]{"camera", "exports"}) {
                File[] files = new File(getCacheDir(), name).listFiles();
                if (files == null) continue;
                for (File f : files) {
                    if (f.lastModified() < limit) f.delete();
                }
            }
        }).start();
    }

    private void shareFile(File f, String mime) {
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, f.getName());
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, "Compartir respaldo"));
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo compartir el archivo", Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------
    // Ciclo de vida
    // ------------------------------------------------------------------
    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
