# Changelog - Version 1.6.1

## Changelog - Version 1.7.0 (2025-11-05)

### Summary
- Improved note browsing UX: fixed bookmark filter and added drag & drop re-ordering with a visible placeholder and auto-scroll support.
- Improved save UX: auto-saves now show a bottom toast and top toolbar save status is cleared to avoid layout shifts.
- Developer/bugfix: fixed placeholder drop behavior (including drops into whitespace and top-of-list), made placeholder insertion robust, and added cache-busting for webview assets during development.
- Misc: improved handling for custom storage locations when no workspace is open and bumped package to 1.7.0.

### Notable changes
- Fix: Browse modal bookmark filter now correctly filters Bookmarked/All notes.
- Feature: Drag & drop note re-ordering in the Browse Notes modal.
  - Visible placeholder element with stronger styling for all themes.
  - Auto-scroll when dragging near list edges.
  - Corrected index math so dragged notes land at the expected position (handles top, middle and end placements).
- UX: Auto-save uses a non-blocking bottom toast ('Auto-saved') instead of writing 'Auto-saving...' into the top toolbar (manual saves still show clear feedback via toast).
- Fix: Dropping directly onto placeholder space (including the top-most placeholder) is now supported and deterministic.
- Dev: Appends cache-busting query params to `main.js` and `main.css` URIs so the webview loads fresh assets during development.
- Other: Version bumped to 1.7.0 and new VSIX packaged.

### Files changed
- `media/main.js` — bookmark filter fix, drag & drop implementation, placeholder + auto-scroll, save UI changes, placeholder drop handling.
- `media/main.css` — styles for `.note-placeholder` and toast UI.
- `src/webviewProvider.ts` — cache-busting of webview URIs and custom path handling fixes.
- `package.json` — version bumped to 1.7.0.

---

## 🎉 Major SyncThing Integration Improvements

### New Features

#### 1. **Visual Diff Viewer for Conflicts** 🔍
- When a SyncThing conflict is detected, VS Code's built-in diff viewer now automatically opens
- Side-by-side comparison shows exactly what changed between versions
- Much easier to see differences than viewing raw JSON

#### 2. **Three-Way Conflict Resolution** 🔀
Now offers **three** resolution strategies:
- **Keep Current Version** - Discard conflict file, keep your current notes
- **Use Conflict Version** - Replace with the synced version from other device
- **Merge Both Versions** ✨ - Intelligently combines unique pages from both versions

#### 3. **Smart Merge Algorithm** 🧠
When you choose "Merge":
- Combines all unique pages (deduplicates by content)
- Preserves bookmarks from both versions
- Uses the most recent metadata (state, currentPage)
- Shows total page count after merge

#### 4. **Improved UX** 💫
- **`ignoreFocusOut: true`** - Clicking outside the quick pick no longer dismisses it accidentally
- **Better icons** - Visual indicators for each option (←, →, merge symbol, ✕)
- **Descriptive labels** - Each option explains what it does
- **Success notifications** - Clear feedback with ✓ checkmarks
- **Auto-reload** - Notes automatically refresh after conflict resolution

#### 5. **Enhanced Detection & Logging** 📊
- Checks for conflicts on extension load
- Detailed console logging for debugging
- File watcher properly initialized when webview ready
- Active scanning of `.vscode` directory

### Bug Fixes

#### Fixed: Accidental Conflict Resolution
**Problem**: Clicking outside the quick pick palette would resolve the conflict without user input

**Solution**: Added `ignoreFocusOut: true` to the QuickPick options, preventing accidental dismissal

#### Fixed: Missing Diff Viewer
**Problem**: Users had to manually view conflict files with no comparison

**Solution**: Automatically opens VS Code's diff viewer showing current ↔ conflict side-by-side

### Technical Changes

- Added `getNotesFilePathPublic()` method to StorageService
- Improved conflict detection with detailed logging
- Better error handling for merge operations
- File watcher setup moved to `resolveWebviewView()` lifecycle
- Check for SyncThing conflicts during `handleInitialDataRequest()`

### Configuration

All existing sync settings work with the new features:
```json
{
  "better-sidebar-markdown-notes.sync.enableFileWatcher": true,
  "better-sidebar-markdown-notes.sync.checkSyncThingConflicts": true,
  "better-sidebar-markdown-notes.sync.conflictResolution": "manual"
}
```

### Usage Example

**Scenario**: You edited notes on two computers simultaneously

1. **Extension loads** → Detects SyncThing conflict file
2. **Popup appears** → "SyncThing conflict detected! Resolve now?"
3. **You click "Resolve"**
4. **Diff viewer opens** → Shows side-by-side comparison
5. **Quick pick appears** with 4 options:
   - ← Keep Current Version
   - → Use Conflict Version  
   - ⚡ Merge Both Versions (recommended!)
   - ✕ Cancel
6. **You choose "Merge"**
7. **Extension merges** → Combines unique pages from both
8. **Success!** → "✓ Merged versions successfully (15 total pages)"
9. **Notes reload** → You see all your content

### Breaking Changes

None! All changes are backward compatible.

### Known Limitations

- Merge algorithm deduplicates by exact content match (doesn't detect similar pages)
- Page order after merge may differ from original
- Bookmarks position may shift if pages are reordered

### Recommended Workflow

For best results with SyncThing:

1. **Increase auto-save interval**: `"autoSaveInterval": 3000` (3 seconds)
2. **Use "Merge" option**: When in doubt, merge preserves all content
3. **Review diff first**: Check what changed before choosing
4. **Keep backups enabled**: All resolutions create automatic backups

---

**Upgrade Note**: Reload VS Code window after installing this version to activate the new features!

## Testing

Tested scenarios:
- ✅ Conflict detection on extension load
- ✅ Diff viewer display
- ✅ Quick pick with `ignoreFocusOut`
- ✅ Merge operation with multiple pages
- ✅ Keep current/Use conflict options
- ✅ Cancel without resolving
- ✅ Multiple conflict files in sequence
- ✅ Auto-reload after resolution

## Credits

Special thanks to the users who reported the issues and helped test the improvements! 🙏
