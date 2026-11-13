import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { createMarkdownTextblocks } from "./markdown-bold";
import { copyEditorSelection, pasteEditorMarkdown } from "./clipboard";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
});
const makeEditor = (content = "", contentType: "markdown" | "html" = "markdown") => new Editor({
  extensions: [StarterKit.configure({ paragraph: false, heading: false }), ...createMarkdownTextblocks(), Markdown], content, contentType,
});

test("reproduces stock Markdown losing bold before a Korean particle", () => {
  const original = new Editor({ extensions: [StarterKit, Markdown], content: "<p><strong>카이사르 암호(Caesar cipher)</strong>는</p>", contentType: "html" });
  const reloaded = new Editor({ extensions: [StarterKit, Markdown], content: original.getMarkdown(), contentType: "markdown" });
  assert.match(original.getHTML(), /<strong>/);
  assert.doesNotMatch(reloaded.getHTML(), /<strong>/);
  original.destroy(); reloaded.destroy();
});

for (const html of [
  "<p>흔히 <strong>카이사르 암호(Caesar cipher)</strong>는 암호이다.</p>",
  "<p><strong>ROT(Rotate)</strong>는 회전이다.</p>",
  "<p>앞<strong>(괄호)</strong>뒤, <strong>기호!</strong>다음</p>",
  "<p><strong>굵게 <em>기울임</em> 끝</strong>은 유지된다.</p>",
  "<p><strong>굵게 <code>bytes()</code> 코드</strong>는 유지된다.</p>",
  '<p><a href="https://example.com"><strong>링크(참고)</strong></a>는 유지된다.</p>',
  '<h2><strong>제목(heading)</strong>과 <em>기울임</em></h2>',
  '<ul><li><p><strong>목록(list)</strong>은 유지된다.</p></li></ul>',
]) {
  test(`bold survives repeated save/reopen: ${html}`, () => {
    const original = makeEditor(html, "html");
    const expected = original.getJSON();
    let markdown = original.getMarkdown();
    assert.match(markdown, /<strong>/);
    for (let i = 0; i < 3; i++) {
      const reloaded = makeEditor(markdown);
      assert.deepEqual(reloaded.getJSON(), expected);
      markdown = reloaded.getMarkdown();
      reloaded.destroy();
    }
    original.destroy();
  });
}

test("toolbar bold and remove-bold preserve exact text and code examples", () => {
  const editor = makeEditor("카이사르 암호(Caesar cipher)는\n\n```text\n**literal**는\n```\n\n마지막 문단");
  const text = editor.getText();
  const end = 1 + "카이사르 암호(Caesar cipher)".length;
  editor.commands.setTextSelection({ from: 1, to: end });
  editor.commands.setBold();
  const reloaded = makeEditor(editor.getMarkdown());
  assert.deepEqual(reloaded.getJSON(), editor.getJSON());
  assert.equal(reloaded.getText(), text);
  reloaded.commands.setTextSelection({ from: 1, to: end });
  reloaded.commands.unsetBold();
  assert.doesNotMatch(reloaded.getHTML(), /<strong>/);
  assert.equal(reloaded.getText(), text);
  editor.destroy(); reloaded.destroy();
});

test("internal Markdown copy/paste preserves punctuation-ending bold", () => {
  const editor = makeEditor("<p><strong>카이사르 암호(Caesar cipher)</strong>는 그대로</p>", "html");
  editor.commands.selectAll();
  const values = new Map<string, string>();
  const event = { clipboardData: { setData: (key: string, value: string) => values.set(key, value), getData: (key: string) => values.get(key) ?? "" }, preventDefault() {} } as unknown as ClipboardEvent;
  copyEditorSelection(editor, event, "markdown");
  const pasted = makeEditor();
  pasteEditorMarkdown(pasted, event, "markdown");
  assert.deepEqual(pasted.getJSON(), editor.getJSON());
  editor.destroy(); pasted.destroy();
});
