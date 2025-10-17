# Sidebar Markdown Notes - Cloud Sync Setup Guide

## Overview

The Sidebar Markdown Notes extension now supports automatic file-based persistence and cloud synchronization. Your notes are automatically saved to files that can be synchronized across multiple devices using cloud storage services.

## Features

### ✅ Automatic File-Based Storage
- Notes are automatically saved to `.vscode/sidebar-notes.json` in your workspace
- Real-time auto-save with configurable intervals (default: 1 second)
- Automatic backup creation before each save

### ✅ Cloud Synchronization Ready
- Files stored in `.vscode` folder are automatically synced by most cloud services
- Works with OneDrive, Google Drive, Dropbox, iCloud, and other cloud storage
- Cross-device synchronization with conflict resolution

### ✅ Backup & Restore System
- Automatic backups created before each save
- Manual backup creation via command palette
- Easy restore from backup with date/time selection
- Configurable backup retention (default: 10 backups)

### ✅ Migration Support
- Automatic migration from old webview-based storage
- Pre-migration backups for safety
- Seamless transition with no data loss

## Quick Setup for Cloud Sync

### Option 1: Default Setup (Recommended)
1. **Open your project in VSCode**
2. **Ensure your project folder is synced to cloud storage**
   - OneDrive: Place project in `OneDrive/Documents/` or similar
   - Google Drive: Use Google Drive desktop app
   - Dropbox: Place project in Dropbox folder
3. **Start using the extension** - it will automatically create `.vscode/sidebar-notes.json`
4. **Your notes will sync automatically** across all devices with the same cloud folder

### Option 2: Custom Storage Location
1. Open VSCode Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "sidebar markdown notes"
3. Set **Storage Location** to "custom"
4. Set **Custom Path** to your preferred cloud-synced folder
5. Restart VSCode

## Configuration Options

### Storage Settings
```json
{
  "sidebar-markdown-notes.storage.location": "workspace", // or "custom"
  "sidebar-markdown-notes.storage.customPath": "", // path when using custom
  "sidebar-markdown-notes.storage.autoSave": true,
  "sidebar-markdown-notes.storage.autoSaveInterval": 1000 // milliseconds
}
```

### Backup Settings
```json
{
  "sidebar-markdown-notes.backup.enabled": true,
  "sidebar-markdown-notes.backup.maxBackups": 10
}
```

### Sync Settings
```json
{
  "sidebar-markdown-notes.sync.conflictResolution": "manual" // or "timestamp"
}
```

## Available Commands

Access these commands via Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- **Create Backup** - Manually create a backup of current notes
- **Restore from Backup** - Choose and restore from available backups
- **Open Storage Folder** - Open the folder containing your notes files
- **Reset Migration (Debug)** - Reset migration state for troubleshooting

## File Structure

When using default settings, your workspace will contain:
```
your-project/
├── .vscode/
│   ├── sidebar-notes.json              # Main notes file
│   ├── sidebar-notes-backups/          # Backup directory
│   │   ├── backup-2024-01-15-10-30-00.json
│   │   ├── backup-2024-01-14-15-45-30.json
│   │   └── ...
│   └── settings.json                   # VSCode settings
└── ... (your project files)
```

## Cloud Service Specific Setup

### OneDrive
1. Place your project folder in OneDrive
2. Ensure OneDrive is syncing properly
3. The `.vscode` folder will sync automatically

### Google Drive
1. Install Google Drive desktop app
2. Place project in Google Drive folder
3. Enable "Mirror files" or "Stream files" as preferred

### Dropbox
1. Place project in Dropbox folder
2. Ensure Dropbox is running and syncing
3. Check sync status in Dropbox system tray

### iCloud Drive
1. Place project in iCloud Drive folder
2. Ensure "Desktop and Documents" sync is enabled (macOS)
3. Wait for initial sync to complete

## Troubleshooting

### Notes Not Syncing
1. Check if cloud service is running and syncing
2. Verify `.vscode` folder is not excluded from sync
3. Use "Open Storage Folder" command to verify file location
4. Check cloud service sync status

### Migration Issues
1. Use "Reset Migration (Debug)" command
2. Restart VSCode
3. Check for error messages in Developer Console (`Help > Toggle Developer Tools`)

### Backup/Restore Problems
1. Verify backup folder exists: `.vscode/sidebar-notes-backups/`
2. Check file permissions in storage directory
3. Try creating manual backup first

### Conflict Resolution
When the same notes are modified on multiple devices:
- **Manual mode** (default): You'll be prompted to choose which version to keep
- **Timestamp mode**: Automatically uses the most recently modified version

## Best Practices

1. **Regular Backups**: Use manual backup before major changes
2. **Sync Verification**: Check that files appear on other devices
3. **Conflict Handling**: Resolve conflicts promptly when they occur
4. **Storage Location**: Use workspace storage for project-specific notes
5. **Custom Path**: Use custom path for global notes across all projects

## Security Considerations

- Notes are stored as plain text JSON files
- Ensure your cloud storage has appropriate security settings
- Consider encryption for sensitive information
- Backup files contain full note history

## Support

If you encounter issues:
1. Check this guide first
2. Look for error messages in VSCode Developer Console
3. Try the troubleshooting steps above
4. Report issues on the GitHub repository

---

**Happy note-taking with cloud sync! 📝☁️**
