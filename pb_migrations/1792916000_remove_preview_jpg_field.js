/// <reference path="../pb_data/types.d.ts" />
// Removes the draft preview image field — the server-side preview renderer
// approach was abandoned (too heavy for this machine). Field-absent safe.
migrate((app) => {
  try {
    const drafts = app.findCollectionByNameOrId("bill_drafts")
    if (drafts.fields.getByName("preview_jpg")) {
      drafts.fields.removeByName("preview_jpg")
      app.save(drafts)
    }
  } catch (err) {
    // Field already gone (fresh replay without the add migration) — nothing to do.
    console.log("remove_preview_jpg: nothing to remove")
  }
}, (app) => {
  // Down: re-add the field in case this migration needs reverting.
  try {
    const drafts = app.findCollectionByNameOrId("bill_drafts")
    if (!drafts.fields.getByName("preview_jpg")) {
      drafts.fields.addAt(drafts.fields.length, new Field({
        "hidden": false,
        "id": "file_draft_preview_jpg",
        "maxSelect": 1,
        "maxSize": 5242880,
        "mimeTypes": ["image/jpeg"],
        "name": "preview_jpg",
        "presentable": false,
        "protected": false,
        "required": false,
        "system": false,
        "thumbs": null,
        "type": "file"
      }))
      app.save(drafts)
    }
  } catch (err) {
    console.log("remove_preview_jpg down: could not re-add")
  }
})
