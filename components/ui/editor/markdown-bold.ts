import type { JSONContent, Editor } from "@tiptap/core";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";
import { DOMSerializer, type Schema } from "@tiptap/pm/model";

// Markdown delimiters cannot close after punctuation immediately followed by a
// letter: **Caesar cipher)**는 reloads as literal stars. Semantic inline HTML
// preserves the exact selection without adding spaces or changing the prose.
const hasBold = (node: JSONContent): boolean =>
  Boolean(node.marks?.some((mark) => mark.type === "bold") || node.content?.some(hasBold));

function inlineHtml(schema: Schema, node: JSONContent): string {
  const container = document.createElement("div");
  container.append(DOMSerializer.fromSchema(schema).serializeFragment(schema.nodeFromJSON(node).content));
  // Parse as one inline HTML fragment so spaces at adjacent mark boundaries
  // are not trimmed independently (for example bold text beside inline code).
  return `<span>${container.innerHTML}</span>`;
}

// Serialize the entire inline fragment together: mixing Markdown links/italics
// inside <strong> would be read as literal characters by Tiptap's HTML parser.
export function createMarkdownTextblocks() {
  // The installed Markdown manager does not pass Editor in renderMarkdown's
  // context. Capture its schema per editor before serialization can run.
  let schema: Schema;
  function onBeforeCreate(this: { editor: Editor }) { schema = this.editor.schema; }
  return [
    Paragraph.extend({
      onBeforeCreate,
      renderMarkdown(node, helpers, context) {
        if (hasBold(node)) return inlineHtml(schema, node);
        return this.parent?.(node, helpers, context) ?? helpers.renderChildren(node.content ?? []);
      },
    }),
    Heading.extend({
      onBeforeCreate,
      renderMarkdown(node, helpers, context) {
        if (hasBold(node)) return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${inlineHtml(schema, node)}`;
        return this.parent?.(node, helpers, context) ?? "";
      },
    }),
  ];
}
