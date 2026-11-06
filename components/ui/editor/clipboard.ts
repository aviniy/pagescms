import type { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";

export const MARKDOWN_CLIPBOARD_TYPE = "text/x-pages-cms-markdown";

export function copyEditorSelection(editor: Editor, event: ClipboardEvent, format: "markdown" | "html") {
  if (!event.clipboardData || editor.state.selection.empty) return false;
  const fragment = editor.state.selection.content().content;
  const container = document.createElement("div");
  container.append(DOMSerializer.fromSchema(editor.state.schema).serializeFragment(fragment));
  // Keep rich HTML for normal paste and Markdown for a plain-text backup.
  event.clipboardData.setData("text/html", container.innerHTML);
  if (format === "markdown") {
    // A bare node array uses an empty separator. The document renderer preserves
    // paragraph boundaries, image boundaries, and fenced code blocks.
    const markdown = editor.storage.markdown.manager.serialize({ type: "doc", content: fragment.toJSON() });
    event.clipboardData.setData("text/plain", markdown);
    event.clipboardData.setData(MARKDOWN_CLIPBOARD_TYPE, markdown);
  } else {
    event.clipboardData.setData("text/plain", container.innerHTML);
  }
  event.preventDefault();
  return true;
}

export function pasteEditorMarkdown(editor: Editor, event: ClipboardEvent, format: "markdown" | "html") {
  if (format !== "markdown" || !event.clipboardData || editor.isActive("codeBlock")) return false;
  const internal = event.clipboardData.getData(MARKDOWN_CLIPBOARD_TYPE);
  const plain = event.clipboardData.getData("text/plain");
  // Rich clipboard HTML already contains its structure. Also accept Markdown
  // backups pasted from a text editor, without treating ordinary text as Markdown.
  const markdown = internal || (!event.clipboardData.getData("text/html")
    && /^(?:#{1,6}\s|```|~~~|!\[[^\n]*\]\(|\|.+\|\s*$)/m.test(plain) ? plain : "");
  if (!markdown) return false;
  editor.commands.insertContent(markdown, { contentType: "markdown" });
  event.preventDefault();
  return true;
}
