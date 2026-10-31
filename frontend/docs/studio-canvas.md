# Studio image composition

## Run

From `frontend/`, use `npm ci` then `npm run dev`. The Kotlin API remains optional for canvas use; its status continues to appear in the footer.

Add a local JPEG, PNG or WebP (up to 15 MiB / 24 megapixels). Background removal starts automatically. Drag to move; use the lower-right corner or Size slider to resize with the original proportions. Select a piece to bring it forward. Arrow keys move it; Shift increases the movement. Multiple images are supported; imports are serialized while a cutout is running.

The original remains available. “Use original” during processing cancels the worker. After success, switch between original and cutout. Retry restarts processing. Download or inference failure preserves the original. Removal times out after three minutes rather than leaving the UI blocked indefinitely. Removing a piece releases its image URLs.

Composition state survives Studio/Archive navigation in memory. Reloading clears it. Saving through the Kotlin API, durable storage and Archive entries remain a later milestone.

## Removal engine and deployment

`@imgly/background-removal` 1.7.0 runs quantized IS-Net on CPU/WASM inside a dedicated module worker. Images are not uploaded. Model/runtime files download from IMG.LY's default CDN on first use; browser caching can accelerate subsequent runs. Slow/offline/blocked downloads fall back to the original. Each job owns a worker that is terminated on success, cancellation, timeout, removal or unmount.

The dependency is AGPL-licensed; see its bundled LICENSE.md and ThirdPartyLicenses.json. No licence for Undertone itself has been changed. Review compatibility and source-distribution obligations before distributing or publicly hosting the integrated application, or replace this adapter with a suitably licensed engine. Production hosting should also consider self-hosting version-matched model/runtime assets, per the upstream README, and allowing the required module-worker, blob and asset requests in any CSP.

Upstream: https://github.com/imgly/background-removal-js

## Verification

`npm run lint`, `npm run build`, and `npm run test:e2e` from `frontend/`.

Install test browsers once using `npx playwright install chromium`. An existing browser executable can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Browser tests exercise file validation, import, original/cutout switching, drag, resize, keyboard movement, tab retention, removal, retry/cancel, failure fallback and mobile bounds. They simulate only the worker response so they do not depend on model downloads or inference timing. Real-model cutout quality requires a separate clothing-photo check, particularly white garments, fine straps/lace and busy backgrounds. The automated tests do not establish segmentation quality.

Verified in this implementation session: lint and production build passed; five Chromium interaction tests passed. Real-model checks ran on a white-shirt photo (development server) and a shoe photo (production preview). Both produced cutouts; the shoe output included transparent pixels. This is a small functional sample, not a general quality benchmark. Clothing worn by a person retains the person as foreground; this model removes backgrounds rather than isolating the garment from its wearer. Fine details and busy backgrounds still need broader visual evaluation.


## Clipboard import

In the Studio tab, copy an actual image (for example, a browser's **Copy image** command or a screenshot copied to the clipboard), then press Cmd+V on macOS or Ctrl+V on Windows. Paste uses the same file validation, positioning and automatic cutout path as Add image. Images are read from the paste event; the application does not poll the clipboard or request clipboard-read permission.

Paste works only while Studio is active. Ordinary text, image-address URLs and HTML without an attached image file are left untouched; this feature does not fetch remote image URLs. Text inputs and editable fields retain their own paste behaviour. If the clipboard contains multiple images, the first image is imported. JPEG, PNG and WebP, the 15 MiB limit and the 24 megapixel limit apply to pasted images too.

Only one import/cutout runs at a time. Pasting during decoding or cutout processing shows a wait message, without cancelling the active image or losing existing pieces. Choose Use original or wait for completion before pasting the next image. Failed cutouts retain the pasted original and can be retried.

Clipboard changes are grouped into two commits: core image import with its integration test, followed by busy/editable-field safeguards with regression tests and documentation. The original Studio commit is not rewritten.

Clipboard verification: lint and production build pass, and all ten Chromium tests pass, including native clipboard image writing followed by Ctrl+V, rapid-paste protection, active-worker protection, editable/Archive exclusions, plain-URL passthrough, and invalid pasted files. Native clipboard permission is granted by the test harness only to seed the clipboard; the application itself uses the user-triggered paste event.
