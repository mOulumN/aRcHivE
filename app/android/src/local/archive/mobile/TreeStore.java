package local.archive.mobile;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import android.util.Log;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// 사용자가 고른 폴더(구글 드라이브 폴더 포함) 안에 data.json / photos / thumbs 를 읽고 쓴다.
// 안드로이드의 폴더 접근(SAF) 권한을 쓰므로 별도 저장소 권한이 필요 없다.
//
// 드라이브는 파일 하나 묻는 데도 오래 걸리므로 사진은 폰 안에 사본(mirror)을 둔다.
// - 사진 파일은 이름이 고유 번호라 내용이 바뀌지 않는다 → "폰에 있나 없나"만 보면 된다.
// - 읽기: 폰 사본이 있으면 바로, 없으면 폴더에서 받아 사본을 만든다.
// - 쓰기: 폰 사본에 먼저 쓰고 '보낼 목록(outbox)'에 적은 뒤, 뒤에서 폴더로 올린다(끊겨도 다음에 이어서).
// - 미리 받기(prefetch): 목록에 있는데 폰에 없는 사진만 뒤에서 받는다.
// - data.json(기록 목록)은 두 기기가 합쳐 쓰므로 사본 없이 늘 폴더에서 바로 읽고 쓴다.
final class TreeStore {
  interface Progress { void report(int done, int total); }
  static final String TAG = "aRcHivE";

  private final ContentResolver resolver;
  private final Uri tree;
  private final Map<String, String> ids = new HashMap<>();
  // 폴더 하나의 파일 목록을 통째로 한 번만 읽어 둔다. 드라이브는 같은 이름 파일이 여러 개일 수 있어 이름마다 목록으로 둔다.
  private final Map<String, Map<String, List<String>>> listings = new HashMap<>();
  private final File mirror;
  private final File outbox;
  private final Progress progress;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final Set<String> queued = new HashSet<>();
  private int done, total;

  TreeStore(ContentResolver resolver, Uri tree, File mirror, Progress progress) {
    this.resolver = resolver; this.tree = tree; this.mirror = mirror; this.progress = progress;
    this.outbox = new File(mirror, "outbox");
    ids.put("", DocumentsContract.getTreeDocumentId(tree));
  }

  private Uri doc(String id) { return DocumentsContract.buildDocumentUriUsingTree(tree, id); }
  private synchronized void reset() { String root = ids.get(""); ids.clear(); listings.clear(); ids.put("", root); }

  String label() {
    try (Cursor c = resolver.query(doc(ids.get("")), new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
      if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
    } catch (Exception ignored) {}
    return "선택한 폴더";
  }

  void ensureDirs() throws Exception {
    resolve("photos", true, DocumentsContract.Document.MIME_TYPE_DIR);
    resolve("thumbs", true, DocumentsContract.Document.MIME_TYPE_DIR);
  }

  // 드라이브는 목록을 다 받기 전에 "아직 불러오는 중"(EXTRA_LOADING) 표시와 함께 일부만 돌려줄 수 있다.
  // 그 상태에서 "파일이 없다"고 믿으면 빈 data.json을 새로 만들어 버린다(E-01). 다 받을 때까지 기다린다.
  // needComplete=false(읽기만 할 때): 오프라인이면 드라이브가 계속 "불러오는 중"일 수 있으니 잠깐만 기다리고 받은 만큼 쓴다.
  // needComplete=true(새로 만들기 전): 다 받을 때까지 기다리고, 못 받으면 만들지 않는다.
  private static final class Listing { final Map<String, List<String>> map; final boolean complete; Listing(Map<String, List<String>> m, boolean c) { map = m; complete = c; } }
  private Listing query(String parentId, boolean needComplete) throws Exception {
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
    for (int attempt = 0; ; attempt++) {
      Map<String, List<String>> found = new HashMap<>();
      boolean loading;
      try (Cursor c = resolver.query(children, new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
        if (c == null) throw new Exception("폴더 목록을 읽지 못했어요");
        loading = c.getExtras() != null && c.getExtras().getBoolean(DocumentsContract.EXTRA_LOADING, false);
        while (c.moveToNext()) {
          String id = c.getString(0), name = c.getString(1);
          if (id == null || name == null) continue;
          List<String> same = found.get(name);
          if (same == null) found.put(name, same = new ArrayList<>());
          same.add(id);
        }
      }
      for (List<String> same : found.values()) Collections.sort(same);
      if (!loading) return new Listing(found, true);
      if (!needComplete && attempt >= 3) { Log.i(TAG, "폴더 목록 일부만 받음(오프라인일 수 있음)"); return new Listing(found, false); }
      if (attempt >= 12) throw new Exception("드라이브 폴더 목록을 다 받지 못했어요. 인터넷 연결을 확인해 주세요");
      Log.i(TAG, "폴더 목록 불러오는 중… 다시 확인 " + (attempt + 1));
      Thread.sleep(500);
    }
  }

  private synchronized List<String> lookupAll(String parentId, String name, boolean needComplete) throws Exception {
    Map<String, List<String>> list = listings.get(parentId);
    if (list == null) {
      Listing got = query(parentId, needComplete);
      list = got.map;
      if (got.complete) listings.put(parentId, list); // 다 받은 목록만 기억한다
    }
    List<String> same = list.get(name);
    return same == null ? Collections.emptyList() : same;
  }

  private String lookup(String parentId, String name, boolean needComplete) throws Exception {
    List<String> same = lookupAll(parentId, name, needComplete);
    return same.isEmpty() ? null : same.get(0);
  }

  // 'photos/abc.jpg' 같은 상대 경로의 문서 번호를 찾는다. create면 없는 폴더·파일을 만든다.
  private synchronized String resolve(String rel, boolean create, String mime) throws Exception {
    String[] parts = rel.split("/"); String path = ""; String parent = ids.get("");
    for (int i = 0; i < parts.length; i++) {
      boolean last = i == parts.length - 1;
      path = path.isEmpty() ? parts[i] : path + "/" + parts[i];
      String id = ids.get(path);
      if (id == null) id = lookup(parent, parts[i], false);
      if (id == null && create) {
        // 만들기 전에 목록을 새로 "다" 받아 한 번 더 확인한다(덜 받은 목록 때문에 같은 이름 파일을 또 만들지 않도록).
        listings.remove(parent);
        id = lookup(parent, parts[i], true);
      }
      if (id == null) {
        if (!create) return null;
        Log.i(TAG, "새로 만듦: " + path);
        Uri made = DocumentsContract.createDocument(resolver, doc(parent), last ? mime : DocumentsContract.Document.MIME_TYPE_DIR, parts[i]);
        if (made == null) throw new Exception("고른 폴더에 파일을 만들지 못했어요");
        id = DocumentsContract.getDocumentId(made);
        Map<String, List<String>> list = listings.get(parent);
        if (list != null) { List<String> same = new ArrayList<>(); same.add(id); list.put(parts[i], same); }
      }
      ids.put(path, id); parent = id;
    }
    return parent;
  }

  // ---- 폴더(드라이브)에 직접 ----

  private static byte[] readAll(InputStream input) throws Exception {
    try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[65536]; int count;
      while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
      return output.toByteArray();
    }
  }

  private byte[] remoteReadOnce(String rel) throws Exception {
    String id = resolve(rel, false, null);
    if (id == null) return null;
    try (InputStream input = resolver.openInputStream(doc(id))) {
      if (input == null) throw new Exception("파일을 열지 못했어요");
      return readAll(input);
    }
  }

  private void remoteWriteOnce(String rel, byte[] bytes, String mime) throws Exception {
    String id = resolve(rel, true, mime);
    try (OutputStream output = resolver.openOutputStream(doc(id), "wt")) {
      if (output == null) throw new Exception("파일을 쓰지 못했어요");
      output.write(bytes);
    }
  }

  // 폴더가 밖에서 바뀌었을 수 있으니(다른 기기·드라이브 동기화) 한 번은 목록을 다시 읽어 재시도한다.
  byte[] remoteRead(String rel) throws Exception {
    byte[] bytes;
    try { bytes = remoteReadOnce(rel); } catch (Exception error) { reset(); bytes = remoteReadOnce(rel); }
    if (bytes == null) { reset(); bytes = remoteReadOnce(rel); }
    return bytes;
  }
  void remoteWrite(String rel, byte[] bytes, String mime) throws Exception {
    try { remoteWriteOnce(rel, bytes, mime); } catch (Exception error) { Log.w(TAG, "쓰기 재시도: " + rel, error); reset(); remoteWriteOnce(rel, bytes, mime); }
  }

  // 폴더 맨 위의 같은 이름 파일(예: data.json)을 전부 읽는다. 늘 목록을 새로 받는다(다른 기기·드라이브가 바꿀 수 있음).
  List<byte[]> remoteReadAll(String name) throws Exception {
    String root = ids.get("");
    List<String> same;
    synchronized (this) {
      listings.remove(root); ids.remove(name);
      Listing got = query(root, false);
      if (got.complete) listings.put(root, got.map);
      same = got.map.containsKey(name) ? new ArrayList<>(got.map.get(name)) : new ArrayList<>();
      // 목록을 덜 받았는데 파일이 안 보이면 "없다"가 아니라 "모른다"다. 빈 기록으로 오해하지 않게 오류로 알린다.
      if (same.isEmpty() && !got.complete) throw new Exception("드라이브에 연결되지 않아 기록을 읽지 못했어요");
    }
    List<byte[]> out = new ArrayList<>();
    for (String id : same) {
      try (InputStream input = resolver.openInputStream(doc(id))) {
        if (input == null) throw new Exception("파일을 열지 못했어요");
        out.add(readAll(input));
      }
    }
    if (same.size() > 1) Log.w(TAG, name + " 파일이 " + same.size() + "개 있어요. 합쳐서 읽어요");
    return out;
  }

  // 합친 내용을 저장한 뒤, 같은 이름의 나머지 파일은 지우지 않고 이름만 바꿔 남겨 둔다.
  void retireDuplicates(String name) {
    try {
      String root = ids.get("");
      List<String> same;
      synchronized (this) { same = new ArrayList<>(lookupAll(root, name, true)); }
      if (same.size() < 2) return;
      String stem = name.replaceAll("\\.json$", "");
      for (int i = 1; i < same.size(); i++) {
        String renamed = stem + ".conflict-" + System.currentTimeMillis() + "-" + i + ".json";
        DocumentsContract.renameDocument(resolver, doc(same.get(i)), renamed);
        Log.i(TAG, "겹친 " + name + " → " + renamed);
      }
      reset();
    } catch (Exception error) { Log.w(TAG, "겹친 파일 정리 실패(다음에 다시 시도)", error); }
  }
  private void remoteDelete(String rel) throws Exception {
    String id = resolve(rel, false, null);
    if (id == null) return;
    synchronized (this) {
      ids.remove(rel);
      for (Map<String, List<String>> list : listings.values()) for (List<String> same : list.values()) same.remove(id);
    }
    DocumentsContract.deleteDocument(resolver, doc(id));
  }

  // ---- 폰 사본 ----

  private File local(String rel) { return new File(mirror, rel); }
  private File mark(String kind, String rel) { return new File(outbox, kind + "__" + rel.replace('/', '_')); }
  private static String relOf(String marker) {
    String name = marker.substring(marker.indexOf("__") + 2);
    int cut = name.indexOf('_');
    return name.substring(0, cut) + "/" + name.substring(cut + 1);
  }

  private static void save(File file, byte[] bytes) throws Exception {
    File dir = file.getParentFile();
    if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new Exception("폰에 저장하지 못했어요");
    File temp = new File(file.getPath() + ".tmp");
    try (FileOutputStream output = new FileOutputStream(temp)) { output.write(bytes); }
    if (!temp.renameTo(file)) { temp.delete(); throw new Exception("폰에 저장하지 못했어요"); }
  }

  byte[] read(String rel, String mime) throws Exception {
    File file = local(rel);
    if (file.isFile()) try (InputStream input = new FileInputStream(file)) { return readAll(input); }
    // 아직 안 올라간 사진은 폰 사본이 원본이다.
    byte[] bytes = remoteRead(rel);
    if (bytes != null) save(file, bytes);
    return bytes;
  }

  void write(String rel, byte[] bytes, String mime) throws Exception {
    save(local(rel), bytes);
    mark("del", rel).delete();
    save(mark("up", rel), new byte[0]);
    upload(rel, mime);
  }

  void delete(String rel) throws Exception {
    local(rel).delete();
    mark("up", rel).delete();
    save(mark("del", rel), new byte[0]);
    enqueue("del:" + rel, () -> {
      if (!mark("del", rel).exists()) return;
      remoteDelete(rel);
      mark("del", rel).delete();
    });
  }

  private void upload(String rel, String mime) {
    enqueue("up:" + rel, () -> {
      if (!mark("up", rel).exists()) return;
      File file = local(rel);
      if (!file.isFile()) { mark("up", rel).delete(); return; }
      byte[] bytes;
      try (InputStream input = new FileInputStream(file)) { bytes = readAll(input); }
      remoteWrite(rel, bytes, mime);
      mark("up", rel).delete();
    });
  }

  // 앱을 켤 때: 지난번에 못 올린 것·못 지운 것을 이어서 처리한다.
  void resume(MimeOf mimeOf) {
    File[] markers = outbox.listFiles();
    if (markers == null) return;
    for (File m : markers) {
      String name = m.getName();
      if (name.startsWith("up__")) { String rel = relOf(name); upload(rel, mimeOf.of(rel)); }
      else if (name.startsWith("del__")) {
        String rel = relOf(name);
        enqueue("del:" + rel, () -> { if (mark("del", rel).exists()) { remoteDelete(rel); mark("del", rel).delete(); } });
      }
    }
  }
  interface MimeOf { String of(String rel); }

  // 목록에 있는데 폰에 없는 사진만 뒤에서 받는다.
  void prefetch(Iterable<String> rels) {
    for (String rel : rels) {
      if (local(rel).isFile() || mark("del", rel).exists()) continue;
      enqueue("get:" + rel, () -> {
        if (local(rel).isFile()) return;
        byte[] bytes = remoteRead(rel);
        if (bytes != null) save(local(rel), bytes);
      });
    }
  }

  private interface Job { void run() throws Exception; }

  private void enqueue(String key, Job job) {
    synchronized (queued) {
      if (!queued.add(key)) return;
      total++;
    }
    report();
    worker.execute(() -> {
      try { job.run(); } catch (Exception error) { Log.w(TAG, "뒤에서 처리 실패(다음에 다시 시도): " + key, error); }
      synchronized (queued) {
        queued.remove(key);
        done++;
        if (queued.isEmpty()) { done = 0; total = 0; }
      }
      report();
    });
  }

  private void report() {
    int d, t;
    synchronized (queued) { d = done; t = total; }
    if (progress != null) progress.report(d, t);
  }
}
