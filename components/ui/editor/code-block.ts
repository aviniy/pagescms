import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { common, createLowlight } from "lowlight";

export const lowlight = createLowlight(common);

const INDENT = "  ";

const codeBlockRange = (editor: Editor) => {
  const { $from, $to } = editor.state.selection;
  if ($from.parent.type.name !== "codeBlock" || $to.parent.type.name !== "codeBlock") return null;
  if ($from.before() !== $to.before()) return null;

  return {
    start: $from.start(),
    end: $from.end(),
  };
};

export const EnhancedCodeBlock = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Mod-a": () => {
        const range = codeBlockRange(this.editor);
        if (!range) return false;

        this.editor.view.dispatch(
          this.editor.state.tr.setSelection(
            TextSelection.create(this.editor.state.doc, range.start, range.end),
          ),
        );
        return true;
      },
      Tab: () => {
        const range = codeBlockRange(this.editor);
        if (!range) return false;

        const { from, to, empty } = this.editor.state.selection;
        if (empty) {
          const transaction = this.editor.state.tr.insertText(INDENT, from);
          transaction.setSelection(TextSelection.create(transaction.doc, from + INDENT.length));
          this.editor.view.dispatch(transaction.scrollIntoView());
          return true;
        }

        const beforeSelection = this.editor.state.doc.textBetween(range.start, from, "\n", "\n");
        const lastLineBreak = beforeSelection.lastIndexOf("\n");
        const firstLineStart = range.start + lastLineBreak + 1;
        const selectedText = this.editor.state.doc.textBetween(firstLineStart, to, "\n", "\n");
        const lineStarts = [firstLineStart];

        selectedText.split("").forEach((character, index) => {
          if (character === "\n" && firstLineStart + index + 1 <= to) {
            lineStarts.push(firstLineStart + index + 1);
          }
        });

        let transaction = this.editor.state.tr;
        [...lineStarts].reverse().forEach((position) => {
          transaction = transaction.insertText(INDENT, position);
        });

        const nextFrom = from + INDENT.length;
        const nextTo = to + INDENT.length * lineStarts.length;
        transaction = transaction.setSelection(TextSelection.create(transaction.doc, nextFrom, nextTo));
        this.editor.view.dispatch(transaction.scrollIntoView());
        return true;
      },
      "Shift-Tab": () => {
        const range = codeBlockRange(this.editor);
        if (!range) return false;

        const { from, to } = this.editor.state.selection;
        const beforeSelection = this.editor.state.doc.textBetween(range.start, from, "\n", "\n");
        const lastLineBreak = beforeSelection.lastIndexOf("\n");
        const firstLineStart = range.start + lastLineBreak + 1;
        const selectedText = this.editor.state.doc.textBetween(firstLineStart, to, "\n", "\n");
        const lineStarts = [firstLineStart];

        selectedText.split("").forEach((character, index) => {
          if (character === "\n" && firstLineStart + index + 1 <= to) {
            lineStarts.push(firstLineStart + index + 1);
          }
        });

        const removals = lineStarts
          .map((position) => {
            const prefix = this.editor.state.doc.textBetween(position, Math.min(position + 2, range.end));
            const count = prefix.startsWith("\t") ? 1 : prefix.match(/^ {1,2}/)?.[0].length ?? 0;
            return { position, count };
          })
          .filter(({ count }) => count > 0);

        if (!removals.length) return true;

        let transaction = this.editor.state.tr;
        [...removals].reverse().forEach(({ position, count }) => {
          transaction = transaction.delete(position, position + count);
        });

        const removedBeforeFrom = removals
          .filter(({ position }) => position < from)
          .reduce((sum, { count }) => sum + count, 0);
        const removedBeforeTo = removals
          .filter(({ position }) => position < to)
          .reduce((sum, { count }) => sum + count, 0);
        transaction = transaction.setSelection(
          TextSelection.create(
            transaction.doc,
            Math.max(range.start, from - removedBeforeFrom),
            Math.max(range.start, to - removedBeforeTo),
          ),
        );
        this.editor.view.dispatch(transaction.scrollIntoView());
        return true;
      },
    };
  },
}).configure({ lowlight });

