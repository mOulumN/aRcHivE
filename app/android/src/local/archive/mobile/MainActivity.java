package local.archive.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.AtomicFile;
import android.util.Base64;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
  private static final String HOST = "appassets.androidplatform.net";
  private static final int PICK_FILE = 10, SAVE_BACKUP = 11, PICK_FOLDER = 12;
  private WebView web;
  private ValueCallback<Uri[]> chooser;
  private File folder, exportFile;
  // 사용자가 고른 폴더(드라이브 등). null이면 앱 내부 저장소를 쓴다.
  private volatile TreeStore tree;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    folder = new File(getFilesDir(), "archive");
    new File(folder, "photos").mkdirs(); new File(folder, "thumbs").mkdirs();
    exportFile = new File(getCacheDir(), "export.zip");
    loadTree();
    web = new WebView(this);
    web.setBackgroundColor(Color.WHITE);
    web.setHorizontalScrollBarEnabled(false); web.setVerticalScrollBarEnabled(false);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setTextZoom(100); settings.setSupportMultipleWindows(false);
    settings.setSupportZoom(false); settings.setBuiltInZoomControls(false);
    web.addJavascriptInterface(new FilesBridge(), "archiveAndroid");
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return !trusted(request.getUrl());
      }
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!trusted(uri)) return response(403, "Forbidden", "text/plain", new ByteArrayInputStream(new byte[0]));
        String name = uri.getPath();
        if (name == null || name.equals("/")) name = "/index.html";
        if (name.contains("..") || name.contains("\\")) return response(403, "Forbidden", "text/plain", new ByteArrayInputStream(new byte[0]));
        try {
          String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
          String mime = extension.equals("js") ? "text/javascript" : extension.equals("css") ? "text/css"
            : extension.equals("svg") ? "image/svg+xml" : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
          if (mime == null) mime = "application/octet-stream";
          return response(200, "OK", mime, getAssets().open(name.substring(1)));
        } catch (Exception error) { return response(404, "Not Found", "text/plain", new ByteArrayInputStream(new byte[0])); }
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (chooser != null) chooser.onReceiveValue(null);
        chooser = callback;
        try {
          Intent intent = params.createIntent();
          intent.addCategory(Intent.CATEGORY_OPENABLE);
          startActivityForResult(intent, PICK_FILE);
        } catch (Exception error) { chooser.onReceiveValue(null); chooser = null; }
        return true;
      }
    });
    FrameLayout root = new FrameLayout(this);
    root.addView(web, new FrameLayout.LayoutParams(-1, -1));
    setContentView(root);
    if (android.os.Build.VERSION.SDK_INT >= 30) {
      getWindow().setDecorFitsSystemWindows(false);
      root.setOnApplyWindowInsetsListener((view, insets) -> {
        android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
        view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
        return insets;
      });
    }
    web.loadUrl("https://" + HOST + "/index.html");
  }

  private boolean trusted(Uri uri) { return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()); }
  private WebResourceResponse response(int code, String reason, String mime, InputStream data) {
    Map<String, String> headers = new HashMap<>();
    headers.put("X-Content-Type-Options", "nosniff");
    return new WebResourceResponse(mime, "UTF-8", code, reason, headers, data);
  }
  private void loadTree() {
    tree = null;
    android.content.SharedPreferences prefs = getSharedPreferences("archive", MODE_PRIVATE);
    String saved = prefs.getString("tree", null);
    if (saved == null) return;
    Uri uri = Uri.parse(saved);
    for (android.content.UriPermission permission : getContentResolver().getPersistedUriPermissions()) {
      if (permission.getUri().equals(uri) && permission.isReadPermission() && permission.isWritePermission()) {
        tree = new TreeStore(getContentResolver(), uri); return;
      }
    }
    // 권한이 사라졌으면(폴더 삭제·권한 회수) 처음처럼 다시 고르게 한다.
    prefs.edit().remove("tree").remove("label").apply();
  }
  private String mimeOf(String relative) {
    String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(relative.substring(relative.lastIndexOf('.') + 1));
    return mime == null ? "application/octet-stream" : mime;
  }
  private void checkRelative(String relative) throws Exception {
    if (!relative.matches("(photos/[0-9a-f-]{36}\\.[a-z0-9]{2,5}|thumbs/[0-9a-f-]{36}\\.webp)")) throw new Exception("허용되지 않는 파일 경로예요");
  }
  private File photoFile(String relative) throws Exception {
    checkRelative(relative);
    File file = new File(folder, relative);
    if (!file.getCanonicalPath().startsWith(folder.getCanonicalPath() + File.separator)) throw new Exception("허용되지 않는 경로예요");
    return file;
  }
  private byte[] readBytes(File file) throws Exception {
    try (InputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[65536]; int count;
      while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
      return output.toByteArray();
    }
  }
  private void atomicWrite(File file, byte[] bytes) throws Exception {
    AtomicFile atomic = new AtomicFile(file); FileOutputStream stream = null;
    try { stream = atomic.startWrite(); stream.write(bytes); atomic.finishWrite(stream); }
    catch (Exception error) { if (stream != null) atomic.failWrite(stream); throw error; }
  }

  public final class FilesBridge {
    @JavascriptInterface public synchronized String request(String raw) {
      JSONObject reply = new JSONObject();
      try {
        JSONObject args = new JSONObject(raw); String operation = args.getString("operation"); Object value = JSONObject.NULL;
        switch (operation) {
          case "getFolder": {
            android.content.SharedPreferences prefs = getSharedPreferences("archive", MODE_PRIVATE);
            if (tree != null) value = prefs.getString("label", "선택한 폴더");
            else if (new File(folder, "data.json").exists()) value = "앱 내부";
            break;
          }
          case "useInternal": {
            getSharedPreferences("archive", MODE_PRIVATE).edit().remove("tree").remove("label").apply();
            tree = null; value = "앱 내부"; break;
          }
          case "chooseFolder": {
            runOnUiThread(() -> {
              try {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                  | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                startActivityForResult(intent, PICK_FOLDER);
              } catch (Exception error) { folderResult(null, error.getMessage() == null ? "폴더 선택 창을 열지 못했어요" : error.getMessage()); }
            }); break;
          }
          case "readData": if (tree != null) {
            byte[] bytes = tree.read("data.json");
            value = bytes == null ? JSONObject.NULL : new String(bytes, StandardCharsets.UTF_8); break;
          } else {
            AtomicFile atomic = new AtomicFile(new File(folder, "data.json"));
            try (InputStream input = atomic.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
              byte[] buffer = new byte[65536]; int count;
              while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
              value = new String(output.toByteArray(), StandardCharsets.UTF_8);
            } catch (java.io.FileNotFoundException missing) { value = JSONObject.NULL; }
            break;
          }
          case "writeData": {
            String json = args.getString("json"); new JSONObject(json);
            if (tree != null) {
              byte[] previous = tree.read("data.json");
              if (previous != null) tree.write("data.prev.json", previous, "application/json");
              tree.write("data.json", json.getBytes(StandardCharsets.UTF_8), "application/json"); break;
            }
            File file = new File(folder, "data.json");
            if (file.exists()) Files.copy(file.toPath(), new File(folder, "data.prev.json").toPath(), StandardCopyOption.REPLACE_EXISTING);
            atomicWrite(file, json.getBytes(StandardCharsets.UTF_8)); break;
          }
          case "writeFile": {
            String rel = args.getString("rel"); byte[] bytes = Base64.decode(args.getString("data"), Base64.DEFAULT);
            if (tree != null) { checkRelative(rel); tree.write(rel, bytes, mimeOf(rel)); }
            else atomicWrite(photoFile(rel), bytes);
            break;
          }
          case "readFile": {
            if (tree != null) {
              String rel = args.getString("rel"); checkRelative(rel);
              byte[] bytes = tree.read(rel);
              value = bytes == null ? JSONObject.NULL : Base64.encodeToString(bytes, Base64.NO_WRAP); break;
            }
            File file = photoFile(args.getString("rel"));
            value = file.exists() ? Base64.encodeToString(readBytes(file), Base64.NO_WRAP) : JSONObject.NULL; break;
          }
          case "deleteFile": {
            if (tree != null) { String rel = args.getString("rel"); checkRelative(rel); tree.delete(rel); break; }
            File file = photoFile(args.getString("rel"));
            if (file.exists() && !file.delete()) throw new Exception("파일을 삭제하지 못했어요"); break;
          }
          case "exportBackup": {
            atomicWrite(exportFile, Base64.decode(args.getString("data"), Base64.DEFAULT));
            final String name = args.getString("name");
            runOnUiThread(() -> {
              try {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                  .setType("application/zip").putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(intent, SAVE_BACKUP);
              } catch (Exception error) { exportResult(false, error.getMessage()); }
            }); break;
          }
          default: throw new Exception("지원하지 않는 동작이에요");
        }
        reply.put("value", value);
      } catch (Exception error) { try { reply.put("error", error.getMessage() == null ? "저장하지 못했어요" : error.getMessage()); } catch (Exception ignored) {} }
      return reply.toString();
    }
  }

  private void exportResult(boolean saved, String error) {
    exportFile.delete();
    web.evaluateJavascript("window.archiveExportResult && window.archiveExportResult(" + saved + "," + (error == null ? "null" : JSONObject.quote(error)) + ")", null);
  }
  private void folderResult(String label, String error) {
    web.evaluateJavascript("window.archiveFolderResult && window.archiveFolderResult(" + (label == null ? "null" : JSONObject.quote(label)) + "," + (error == null ? "null" : JSONObject.quote(error)) + ")", null);
  }
  @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == PICK_FOLDER) {
      if (resultCode != RESULT_OK || data == null || data.getData() == null) { folderResult(null, null); return; }
      final Uri uri = data.getData();
      new Thread(() -> {
        try {
          getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
          TreeStore picked = new TreeStore(getContentResolver(), uri);
          picked.ensureDirs();
          final String label = picked.label();
          getSharedPreferences("archive", MODE_PRIVATE).edit().putString("tree", uri.toString()).putString("label", label).apply();
          tree = picked;
          runOnUiThread(() -> folderResult(label, null));
        } catch (Exception error) {
          final String message = error.getMessage() == null ? "이 폴더는 쓸 수 없어요" : error.getMessage();
          runOnUiThread(() -> folderResult(null, message));
        }
      }).start();
    } else if (requestCode == PICK_FILE && chooser != null) {
      chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); chooser = null;
    } else if (requestCode == SAVE_BACKUP) {
      if (resultCode != RESULT_OK || data == null || data.getData() == null) { exportResult(false, null); return; }
      final Uri uri = data.getData();
      new Thread(() -> {
        try (InputStream input = new FileInputStream(exportFile); OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
          if (output == null) throw new Exception("저장 위치를 열지 못했어요");
          byte[] buffer = new byte[65536]; int count;
          while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        } catch (Exception error) { runOnUiThread(() -> exportResult(false, error.getMessage())); return; }
        runOnUiThread(() -> exportResult(true, null));
      }).start();
    }
  }
  @Override protected void onPause() {
    if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('archive:flush'))", null);
    super.onPause();
  }
  @Override public void onBackPressed() {
    web.evaluateJavascript("(function(){var m=document.querySelector('.modal-back');if(m){m.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return false;}var t=document.querySelector('.destination-sheet .modal-head button');if(t){t.click();return false;}var d=document.querySelector('.drawer-back');if(d&&d.getClientRects().length){d.click();return false;}var n=document.querySelector('.memo-menu > button:last-of-type');if(n&&n.getClientRects().length){n.click();return false;}var p=document.querySelector('.floating-panel-head button:last-child');if(p){p.click();return false;}var more=document.querySelector('.pane-secondary.open > button,.board-secondary.open > button');if(more){more.click();return false;}return window.dispatchEvent(new Event('archive:back',{cancelable:true}));})()",
      value -> { if ("true".equals(value)) finish(); });
  }
}
