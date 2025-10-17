# Better Sidebar Markdown Notes

[![Marketplace Version](images/icon.png 'Current Release')](https://marketplace.visualstudio.com/items?itemName=therealgorgan.better-sidebar-markdown-notes)

Enhanced markdown notes directly in your sidebar with improved features and cloud sync support.

![demonstration](https://i.imgur.com/O5Tepg8.gif)

## ✨ Enhanced Features

- Multiple pages with easy navigation
- GitHub Flavored Markdown Support
- Auto-save functionality with configurable intervals
- **Cloud sync support** for seamless collaboration
- **Advanced backup system** with restore capabilities
- **Improved conflict resolution** for multi-device usage
- **Custom storage locations** (workspace or custom path)
- The notes are saved automatically as you type

## 🚀 What's Better

This is an enhanced fork of the original sidebar-markdown-notes with:
- Better cloud synchronization
- Enhanced backup and restore features
- Improved storage management
- Better conflict handling for multi-device setups
- More configuration options

## 📥 Importing Notes

### From the Old Extension

If you're migrating from the original `sidebar-markdown-notes` extension:

1. **Automatic Recovery**: The extension automatically scans for and recovers your old notes
2. **Multiple Recovery Methods**:
   - Scans VSCode's global storage locations
   - Checks workspace `.vscode` folders for backup files
   - Looks for common export file names
   - Searches multiple possible data formats
3. **Seamless Import**: Old notes appear directly in the import dialog - no manual steps needed!

### From Markdown Files

Import existing markdown files from your workspace:

1. Click the "Import Notes" button in the sidebar
2. The extension will scan your workspace for `.md` files
3. Select which files you want to import
4. Handle any conflicts (skip, replace, or merge)
5. Your notes will be imported and ready to use

### Supported Formats

- Standard Markdown files (`.md`, `.markdown`)
- Old extension JSON format
- Multiple pages from single files
- Task lists and checkboxes
- Code blocks and formatting

## Available Configurations

- `better-sidebar-markdown-notes.leftMargin`: Adds a left margin to the entire view so it aligns with other content in the sidebar.
- `better-sidebar-markdown-notes.storage.location`: Choose between workspace or custom storage location
- `better-sidebar-markdown-notes.storage.customPath`: Set a custom path for note storage
- `better-sidebar-markdown-notes.storage.autoSave`: Enable/disable auto-save functionality
- `better-sidebar-markdown-notes.storage.autoSaveInterval`: Configure auto-save interval (100-10000ms)

---

Icons made by <a href="https://www.flaticon.com/authors/freepik" title="Freepik">Freepik</a> from <a href="https://www.flaticon.com/" title="Flaticon"> www.flaticon.com</a>
