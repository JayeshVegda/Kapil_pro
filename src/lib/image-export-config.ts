/**
 * Export sizing constants, kept free of any heavy imports.
 *
 * `image-export.ts` pulls in html2canvas and html-to-image, so modules that only
 * need these numbers must not import from it — that would drag the rasterisers
 * into eagerly-loaded chunks and undo the dynamic imports around them.
 */

/**
 * Default JPG width after capture (px). A4 at 300 DPI is ~2480px wide, so this
 * leaves headroom for printing and for zooming into small type on screen.
 */
export const BILL_JPEG_OUTPUT_WIDTH_PX = 3200

/** Cap raster budget (logical w x h x ratio squared) so tall bills stay within canvas limits. */
export const MAX_EXPORT_PIXELS = 52_000_000
