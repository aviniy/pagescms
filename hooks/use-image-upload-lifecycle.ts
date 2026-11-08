"use client";

import { useCallback, useEffect, useRef } from "react";

/** An upload belongs to the mounted editor, not to a particular callback render. */
export function useImageUploadLifecycle(onPendingUploadsChange?: (count: number) => void) {
  const pendingUploadsRef = useRef(0);
  const objectUrlByUploadIdRef = useRef(new Map<string, string>());
  const expectedBlobByUploadIdRef = useRef(new Map<string, string>());
  const notifyRef = useRef(onPendingUploadsChange);

  useEffect(() => {
    notifyRef.current = onPendingUploadsChange;
    onPendingUploadsChange?.(pendingUploadsRef.current);
  }, [onPendingUploadsChange]);

  useEffect(() => {
    const urls = objectUrlByUploadIdRef.current;
    const expected = expectedBlobByUploadIdRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      expected.clear();
      pendingUploadsRef.current = 0;
      notifyRef.current?.(0);
    };
  }, []);

  const updatePendingUploads = useCallback((delta: number) => {
    pendingUploadsRef.current = Math.max(0, pendingUploadsRef.current + delta);
    notifyRef.current?.(pendingUploadsRef.current);
  }, []);

  return { pendingUploadsRef, objectUrlByUploadIdRef, expectedBlobByUploadIdRef, updatePendingUploads };
}
