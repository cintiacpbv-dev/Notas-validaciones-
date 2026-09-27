package com.cintia.misnotas;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
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

    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private ActivityResultLauncher<String[]> permissionLauncher;

    private final Map<String, File> exportFiles = new HashMap<>();
    private final Map<String, OutputStream> exportStreams = new HashMap<>();
    private final Map<String, String> exportMimes = new HashMap<>();

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

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
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
            boolean wantsImages = false;
            for (String a : accept) {
                if (a != null && (a.contains("image") || a.contains("video"))) wantsImages = true;
            }
            if (params.isCaptureEnabled() && wantsImages) {
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
            File photo = new File(dir, "IMG_" + System.currentTimeMillis() + ".jpg");
            cameraOutputUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photo);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            fileChooserLauncher.launch(intent);
        } catch (ActivityNotFoundException e) {
            cameraOutputUri = null;
            launchPicker(new String[]{"image/*"}, false);
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
            String savedWhere = saveToDownloads(f, mime) ? "Descargas" : "";
            final File file = f;
            final String type = mime;
            runOnUiThread(() -> shareFile(file, type));
            return savedWhere;
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
