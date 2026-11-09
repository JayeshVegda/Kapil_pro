/**
 * Single source of truth for the firm identity printed on purchase chitties.
 * Change these constants to rebrand every chitty, print, and JPG export.
 */
export const FIRM_NAME = 'KAPIL PRODUCTS'
export const FIRM_CITY = 'Jamnagar'
// Kept for backwards compatibility with any external callers.
export const FIRM_HEADER = FIRM_NAME
// Subtitle line under the firm name: the city, not a document title.
export const CHITTY_DOC_NAME = FIRM_CITY
