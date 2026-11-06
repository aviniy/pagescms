import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { copyEditorSelection, pasteEditorMarkdown, MARKDOWN_CLIPBOARD_TYPE } from "./clipboard";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
});

const source = "# 문제\n\n첫 문단\n\n![image](/images/image-18.png)\n\n다음 문단\n\n```python\nfor i in range(24):\n    print(i)\n```\n\n마지막 문단";
const makeEditor = (content = "") => new Editor({
  extensions: [StarterKit, Image, Markdown], content, contentType: "markdown",
});
function clipboard() {
  const values = new Map<string, string>();
  return { clipboardData: {
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
  }, preventDefault() {} } as unknown as ClipboardEvent;
}

test("select all, copy, reload and paste preserves paragraphs, images and code", () => {
  const original = makeEditor(source);
  original.commands.selectAll();
  const event = clipboard();
  assert.equal(copyEditorSelection(original, event, "markdown"), true);
  const copied = event.clipboardData!.getData("text/plain");
  assert.match(copied, /image-18\.png\)\n\n다음 문단/);
  assert.match(copied, /```python\nfor i in range\(24\):\n    print\(i\)\n```\n\n마지막/);
  assert.match(event.clipboardData!.getData("text/html"), /<img/);
  const htmlFallback = makeEditor();
  htmlFallback.commands.setContent(event.clipboardData!.getData("text/html"), { contentType: "html" });
  assert.deepEqual(htmlFallback.getJSON(), original.getJSON());
  htmlFallback.destroy();
  const reloaded = makeEditor();
  assert.equal(pasteEditorMarkdown(reloaded, event, "markdown"), true);
  assert.deepEqual(reloaded.getJSON(), original.getJSON());
  for (let i = 0; i < 3; i++) {
    reloaded.commands.selectAll();
    const next = clipboard();
    copyEditorSelection(reloaded, next, "markdown");
    pasteEditorMarkdown(reloaded, next, "markdown");
    assert.deepEqual(reloaded.getJSON(), original.getJSON());
  }
  original.destroy();
  reloaded.destroy();
});

test("plain Markdown backup parses structure, rich HTML stays on the native paste path", () => {
  const editor = makeEditor();
  const plain = clipboard();
  plain.clipboardData!.setData("text/plain", source);
  assert.equal(pasteEditorMarkdown(editor, plain, "markdown"), true);
  assert.match(editor.getHTML(), /<pre><code class="language-python">/);
  const rich = clipboard();
  rich.clipboardData!.setData("text/plain", source);
  rich.clipboardData!.setData("text/html", "<p>formatted text</p>");
  assert.equal(pasteEditorMarkdown(editor, rich, "markdown"), false);
  editor.commands.setContent("```python\nx = 1\n```", { contentType: "markdown" });
  editor.commands.setTextSelection(2);
  plain.clipboardData!.setData(MARKDOWN_CLIPBOARD_TYPE, source);
  assert.equal(pasteEditorMarkdown(editor, plain, "markdown"), false);
  editor.destroy();
});
