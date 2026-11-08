import assert from "node:assert/strict";
import { test } from "node:test";
import { getRawUrl, getRelativeUrl, htmlSwapPrefix, relativeToRawUrls, swapPrefix } from "./github-image";

test("temporary image URLs survive editor/canonical conversions without corrupting their scheme", async () => {
  for (const src of ["blob:https://cms.example/upload-id", "data:image/png;base64,aGVsbG8="]) {
    assert.equal(getRelativeUrl("owner", "repo", "main", src, false), src);
    assert.equal(swapPrefix(src, "", "/images"), src);
    const html = `<p><img src="${src}" alt="image.png"></p>`;
    assert.equal(htmlSwapPrefix(html, "", "/images"), html);
    assert.equal(await relativeToRawUrls("owner", "repo", "main", "default", html), html);
    assert.equal(await getRawUrl("owner", "repo", "main", "default", src), null);
  }
});
test("completed upload paths still resolve to the repository file and published image path", async () => {
  const raw = await getRawUrl("owner", "repo", "main", "default", "public/images/image-25.png");
  assert.equal(raw, "https://raw.githubusercontent.com/owner/repo/main/public/images/image-25.png");
  const relative = getRelativeUrl("owner", "repo", "main", raw!, false);
  assert.equal(swapPrefix(relative, "public/images", "/images"), "/images/image-25.png");
});
