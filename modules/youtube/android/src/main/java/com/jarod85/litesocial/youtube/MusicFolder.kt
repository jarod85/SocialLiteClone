package com.jarod85.litesocial.youtube

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import java.io.IOException
import java.io.OutputStream

/**
 * The music folder MP3s are saved into (the folder Musicolet plays from),
 * chosen once with Android's folder picker. Lite Social keeps access to that
 * folder only, through the Storage Access Framework; it needs no storage
 * permission and can't see anything else.
 */
object MusicFolder {
  /** Opens the picker in the phone's Music folder. */
  fun pickIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
    putExtra(
      DocumentsContract.EXTRA_INITIAL_URI,
      DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Music"),
    )
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
  }

  /** Keeps access across restarts and returns (tree URI, display name). */
  fun persist(context: Context, tree: Uri): Pair<String, String> {
    context.contentResolver.takePersistableUriPermission(
      tree,
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
    )
    val name = DocumentsContract.getTreeDocumentId(tree).substringAfterLast(':').substringAfterLast('/').ifEmpty { "Music" }
    return tree.toString() to name
  }

  fun hasAccess(context: Context, tree: String): Boolean =
    context.contentResolver.persistedUriPermissions.any { it.uri.toString() == tree && it.isWritePermission }

  /** Subfolders of `path` (folder names below the chosen folder), sorted by name. */
  fun list(context: Context, tree: String, path: List<String>): List<String> {
    val treeUri = Uri.parse(tree)
    val parent = resolve(context, treeUri, path, create = false) ?: throw IOException("That folder no longer exists")
    return children(context, treeUri, parent).filter { it.second }.map { it.first }.sortedBy { it.lowercase() }
  }

  /** Returns the folder's name as stored (unsupported characters replaced). */
  fun createFolder(context: Context, tree: String, path: List<String>, name: String): String {
    val treeUri = Uri.parse(tree)
    val clean = cleanName(name)
    resolve(context, treeUri, path + clean, create = true) ?: throw IOException("Couldn't create the folder")
    return clean
  }

  /** Creates `<name>.mp3` in `path` (or "<name> (1).mp3" if taken) and returns its URI. */
  fun createMp3(context: Context, tree: String, path: List<String>, name: String): Uri {
    val treeUri = Uri.parse(tree)
    val parent = resolve(context, treeUri, path, create = true) ?: throw IOException("Couldn't open the folder")
    val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parent)
    return DocumentsContract.createDocument(context.contentResolver, parentUri, "audio/mpeg", cleanName(name))
      ?: throw IOException("Couldn't create the file")
  }

  fun open(context: Context, file: Uri): OutputStream =
    context.contentResolver.openOutputStream(file, "w") ?: throw IOException("Couldn't write the file")

  fun delete(context: Context, file: Uri) {
    runCatching { DocumentsContract.deleteDocument(context.contentResolver, file) }
  }

  /** Human-readable location, e.g. "Music/Rock". */
  fun describe(tree: String, path: List<String>): String {
    val root = runCatching { DocumentsContract.getTreeDocumentId(Uri.parse(tree)).substringAfter(':') }.getOrNull()
      ?.ifEmpty { "Internal storage" } ?: "Music"
    return (listOf(root) + path).joinToString("/")
  }

  /** Walks down `path` from the tree root by display name, optionally creating missing folders. Returns the document id. */
  private fun resolve(context: Context, tree: Uri, path: List<String>, create: Boolean): String? {
    var current = DocumentsContract.getTreeDocumentId(tree)
    for (segment in path) {
      val existing = children(context, tree, current).firstOrNull { it.second && it.first == segment }
      current = when {
        existing != null -> existing.third
        create -> {
          val parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, current)
          val created = DocumentsContract.createDocument(context.contentResolver, parentUri, Document.MIME_TYPE_DIR, segment)
            ?: return null
          DocumentsContract.getDocumentId(created)
        }
        else -> return null
      }
    }
    return current
  }

  /** One query for all children: (name, is folder, document id). */
  private fun children(context: Context, tree: Uri, parentId: String): List<Triple<String, Boolean, String>> {
    val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
    val projection = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE)
    val result = mutableListOf<Triple<String, Boolean, String>>()
    context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
      while (cursor.moveToNext()) {
        val name = cursor.getString(1) ?: continue
        result += Triple(name, cursor.getString(2) == Document.MIME_TYPE_DIR, cursor.getString(0))
      }
    }
    return result
  }

  /** File and folder names: no path separators or characters Android's storage rejects. */
  fun cleanName(name: String): String =
    name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), " ").replace(Regex("\\s+"), " ").trim().trimEnd('.').take(120).ifEmpty { "Untitled" }
}
