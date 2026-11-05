package local.archive.mobile;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

// 사용자가 고른 폴더(구글 드라이브 폴더 포함) 안에 data.json / photos / thumbs 를 읽고 쓴다.
// 안드로이드의 폴더 접근(SAF) 권한을 쓰므로 별도 저장소 권한이 필요 없다.
final class TreeStore {
  private final ContentResolver resolver;
  private final Uri tree;
  private final Map<String, String> ids = new HashMap<>();

  TreeStore(ContentResolver resolver, Uri tree) {
    this.resolver = resolver; this.tree = tree;
    ids.put("", DocumentsContract.getTreeDocumentId(tree));
  }

  private Uri doc(String id) { return DocumentsContract.buildDocumentUriUsingTree(tree, id); }
  private void reset() { String root = ids.get(""); ids.clear(); ids.put("", root); }

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

  private String lookup(String parentId, String name) {
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
    try (Cursor c = resolver.query(children, new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
      while (c != null && c.moveToNext()) if (name.equals(c.getString(1))) return c.getString(0);
    }
    return null;
  }

  // 'photos/abc.jpg' 같은 상대 경로의 문서 번호를 찾는다. create면 없는 폴더·파일을 만든다.
  private String resolve(String rel, boolean create, String mime) throws Exception {
    String[] parts = rel.split("/"); String path = ""; String parent = ids.get("");
    for (int i = 0; i < parts.length; i++) {
      boolean last = i == parts.length - 1;
      path = path.isEmpty() ? parts[i] : path + "/" + parts[i];
      String id = ids.get(path);
      if (id == null) id = lookup(parent, parts[i]);
      if (id == null) {
        if (!create) return null;
        Uri made = DocumentsContract.createDocument(resolver, doc(parent), last ? mime : DocumentsContract.Document.MIME_TYPE_DIR, parts[i]);
        if (made == null) throw new Exception("고른 폴더에 파일을 만들지 못했어요");
        id = DocumentsContract.getDocumentId(made);
      }
      ids.put(path, id); parent = id;
    }
    return parent;
  }

  private byte[] readOnce(String rel) throws Exception {
    String id = resolve(rel, false, null);
    if (id == null) return null;
    try (InputStream input = resolver.openInputStream(doc(id)); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      if (input == null) throw new Exception("파일을 열지 못했어요");
      byte[] buffer = new byte[65536]; int count;
      while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
      return output.toByteArray();
    }
  }

  private void writeOnce(String rel, byte[] bytes, String mime) throws Exception {
    String id = resolve(rel, true, mime);
    try (OutputStream output = resolver.openOutputStream(doc(id), "wt")) {
      if (output == null) throw new Exception("파일을 쓰지 못했어요");
      output.write(bytes);
    }
  }

  // 폴더가 밖에서 바뀌었을 수 있으니(드라이브 동기화 등) 한 번은 목록을 다시 읽어 재시도한다.
  byte[] read(String rel) throws Exception {
    try { return readOnce(rel); } catch (Exception error) { reset(); return readOnce(rel); }
  }
  void write(String rel, byte[] bytes, String mime) throws Exception {
    try { writeOnce(rel, bytes, mime); } catch (Exception error) { reset(); writeOnce(rel, bytes, mime); }
  }
  void delete(String rel) throws Exception {
    String id = resolve(rel, false, null);
    if (id == null) return;
    ids.remove(rel);
    DocumentsContract.deleteDocument(resolver, doc(id));
  }
}
