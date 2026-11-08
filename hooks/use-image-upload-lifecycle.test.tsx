import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useImageUploadLifecycle } from "./use-image-upload-lifecycle";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("rerendering during an upload retains the preview, upload identity and pending count", async () => {
  const revoked: string[] = [];
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  const firstCounts: number[] = [], nextCounts: number[] = [];
  let uploads!: ReturnType<typeof useImageUploadLifecycle>;
  function Harness({ notify }: { notify: (count: number) => void }) {
    const state = useImageUploadLifecycle(notify);
    useEffect(() => { uploads = state; });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness notify={(count) => firstCounts.push(count)} />));
    uploads.objectUrlByUploadIdRef.current.set("upload-1", "blob:preview-1");
    uploads.expectedBlobByUploadIdRef.current.set("upload-1", "blob:preview-1");
    await act(async () => uploads.updatePendingUploads(1));
    for (let i = 0; i < 5; i++) {
      await act(async () => root.render(<Harness notify={(count) => nextCounts.push(count)} />));
    }
    assert.deepEqual(revoked, []);
    assert.equal(uploads.pendingUploadsRef.current, 1);
    assert.equal(uploads.expectedBlobByUploadIdRef.current.get("upload-1"), "blob:preview-1");
    assert.equal(uploads.objectUrlByUploadIdRef.current.get("upload-1"), "blob:preview-1");
    assert.ok(nextCounts.every((count) => count === 1));
    // The completion callback can still match and replace the original blob.
    uploads.expectedBlobByUploadIdRef.current.delete("upload-1");
    uploads.objectUrlByUploadIdRef.current.delete("upload-1");
    await act(async () => uploads.updatePendingUploads(-1));
    assert.equal(nextCounts.at(-1), 0);
    assert.deepEqual(firstCounts, [0, 1]);
    // A failed second upload keeps its local preview until the editor unmounts.
    uploads.objectUrlByUploadIdRef.current.set("upload-2", "blob:preview-2");
    uploads.expectedBlobByUploadIdRef.current.set("upload-2", "blob:preview-2");
    await act(async () => uploads.updatePendingUploads(1));
    await act(async () => root.unmount());
    assert.deepEqual(revoked, ["blob:preview-2"]);
    assert.equal(uploads.expectedBlobByUploadIdRef.current.size, 0);
    assert.equal(nextCounts.at(-1), 0);
  } finally { URL.revokeObjectURL = originalRevoke; }
});
