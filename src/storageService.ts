import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';

export interface NotesData {
  version: number;
  lastModified: string; // ISO timestamp
  deviceId: string; // For conflict resolution
  state: 'editor' | 'render';
  currentPage: number;
  pages: string[];
  bookmarks?: boolean[]; // Per-note bookmark flags (index matches pages array)
  metadata: {
    totalPages: number;
    createdAt: string;
    syncStatus?: 'synced' | 'pending' | 'conflict';
    fileModTime?: number; // File modification timestamp for conflict detection
  };
}

export interface LegacyNotesData {
  state: 'editor' | 'render';
  currentPage: number;
  pages: string[];
  version: number;
}

export class StorageService {
  private readonly notesFilename = 'sidebar-notes.json';
  private readonly backupFolder = 'sidebar-notes-backups';
  private deviceId: string;
  private lastKnownModTime: number = 0;
  private fileWatcher?: vscode.FileSystemWatcher;
  private suppressFileWatcherEvents: boolean = false;

  constructor(private context: vscode.ExtensionContext) {
    // Generate or retrieve a unique device ID for conflict resolution
    this.deviceId = this.context.globalState.get('deviceId') || this.generateDeviceId();
    this.context.globalState.update('deviceId', this.deviceId);
  }

  private generateDeviceId(): string {
    return `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get the storage path based on configuration
   */
  private getStoragePath(): string {
    const config = getConfig();
    const storageConfig = config.storage;

    if (storageConfig.location === 'custom' && storageConfig.customPath) {
      return path.resolve(storageConfig.customPath);
    }

    // Default: use workspace .vscode folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      // Fallback: use global storage path when no workspace is open
      const globalStoragePath = this.context.globalStorageUri.fsPath;
      console.log('No workspace folder found, using global storage:', globalStoragePath);
      return globalStoragePath;
    }

    return path.join(workspaceFolder.uri.fsPath, '.vscode');
  }

  /**
   * Get the full path to the notes file
   */
  private getNotesFilePath(): string {
    return path.join(this.getStoragePath(), this.notesFilename);
  }

  /**
   * Get the full path to the notes file (public accessor)
   */
  getNotesFilePathPublic(): string {
    return this.getNotesFilePath();
  }

  /**
   * Get the backup directory path
   */
  private getBackupDirectoryPath(): string {
    return path.join(this.getStoragePath(), this.backupFolder);
  }

  /**
   * Ensure the storage directory exists
   */
  private async ensureStorageDirectory(): Promise<void> {
    const storagePath = this.getStoragePath();

    try {
      await fs.promises.access(storagePath);
    } catch {
      await fs.promises.mkdir(storagePath, { recursive: true });
    }
  }

  /**
   * Ensure the backup directory exists
   */
  private async ensureBackupDirectory(): Promise<void> {
    const backupPath = this.getBackupDirectoryPath();

    try {
      await fs.promises.access(backupPath);
    } catch {
      await fs.promises.mkdir(backupPath, { recursive: true });
    }
  }

  /**
   * Create a backup of the current notes file
   */
  async createBackup(): Promise<string | null> {
    const config = getConfig();
    if (!config.backup.enabled) {
      return null;
    }

    const notesPath = this.getNotesFilePath();

    try {
      // Check if notes file exists
      await fs.promises.access(notesPath);

      await this.ensureBackupDirectory();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupFileName = `backup-${timestamp}.json`;
      const backupPath = path.join(this.getBackupDirectoryPath(), backupFileName);

      await fs.promises.copyFile(notesPath, backupPath);

      // Clean up old backups
      await this.cleanupOldBackups();

      return backupPath;
    } catch (error) {
      // If notes file doesn't exist, no backup needed
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Clean up old backup files based on maxBackups setting
   */
  private async cleanupOldBackups(): Promise<void> {
    const config = getConfig();
    const backupDir = this.getBackupDirectoryPath();

    try {
      const files = await fs.promises.readdir(backupDir);
      const backupFiles = files
        .filter((file) => file.startsWith('backup-') && file.endsWith('.json'))
        .map((file) => ({
          name: file,
          path: path.join(backupDir, file),
          stat: fs.statSync(path.join(backupDir, file))
        }))
        .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

      // Keep only the most recent maxBackups files
      const filesToDelete = backupFiles.slice(config.backup.maxBackups);

      for (const file of filesToDelete) {
        await fs.promises.unlink(file.path);
      }
    } catch (error) {
      console.warn('Failed to cleanup old backups:', error);
    }
  }

  /**
   * Load notes from file
   */
  async loadNotes(): Promise<NotesData | null> {
    const notesPath = this.getNotesFilePath();

    try {
      const data = await fs.promises.readFile(notesPath, 'utf8');
      const stat = await fs.promises.stat(notesPath);
      const parsed = JSON.parse(data);

      // If file looks like legacy v1 format (no version or version === 1), attempt migration
      if (parsed && typeof parsed === 'object' && (!parsed.version || parsed.version === 1)) {
        try {
          // Create a backup of the original file before migrating
          await this.ensureBackupDirectory();
          const backupFileName = `pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          const backupPath = path.join(this.getBackupDirectoryPath(), backupFileName);
          await fs.promises.copyFile(notesPath, backupPath);

          // Convert legacy data to new format
          const migrated = this.convertLegacyData(parsed as LegacyNotesData);

          // Persist migrated data
          const jsonData = JSON.stringify(migrated, null, 2);
          await fs.promises.writeFile(notesPath, jsonData, 'utf8');

          return migrated;
        } catch (migrateError) {
          console.warn('Failed to migrate legacy notes file:', migrateError);
          // Fall through to validation error
        }
      }

      const notesData = parsed as NotesData;

      // Validate the data structure
      if (!this.isValidNotesData(notesData)) {
        throw new Error('Invalid notes data format');
      }

      // Store file modification time for conflict detection
      this.lastKnownModTime = stat.mtimeMs;
      if (!notesData.metadata.fileModTime) {
        notesData.metadata.fileModTime = stat.mtimeMs;
      }

      // Migration: Initialize bookmarks array if it doesn't exist
      // This ensures backward compatibility with notes created before bookmark feature
      if (!notesData.bookmarks || notesData.bookmarks.length !== notesData.pages.length) {
        notesData.bookmarks = new Array(notesData.pages.length).fill(false);
        console.log('[StorageService] Migrated notes to include bookmarks array');
        // Save the migrated data
        await this.saveNotes(notesData);
      }

      return notesData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet
        return null;
      }
      throw error;
    }
  }

  /**
   * Save notes to file
   */
  async saveNotes(notesData: NotesData, skipConflictCheck: boolean = false): Promise<void> {
    await this.ensureStorageDirectory();

    const notesPath = this.getNotesFilePath();

    // Check for conflicts before saving (unless explicitly skipped)
    if (!skipConflictCheck && this.lastKnownModTime > 0) {
      try {
        const stat = await fs.promises.stat(notesPath);
        
        // If file was modified externally since we last read it
        if (stat.mtimeMs > this.lastKnownModTime) {
          // File has been modified externally - potential conflict
          const config = getConfig();
          
          if (config.sync.conflictResolution === 'timestamp') {
            // Auto-resolve: Load the external version and compare timestamps
            const externalData = await this.loadNotes();
            
            if (externalData) {
              const externalTime = new Date(externalData.lastModified).getTime();
              const localTime = new Date(notesData.lastModified).getTime();
              
              // If external version is newer, don't overwrite
              if (externalTime > localTime) {
                throw new Error('CONFLICT_EXTERNAL_NEWER');
              }
            }
          } else {
            // Manual resolution required
            throw new Error('CONFLICT_DETECTED');
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Re-throw if it's not a "file doesn't exist" error
          throw error;
        }
      }
    }

    // Create backup before saving
    await this.createBackup();

    // Update metadata
    notesData.lastModified = new Date().toISOString();
    notesData.deviceId = this.deviceId;
    notesData.metadata.totalPages = notesData.pages.length;

    const jsonData = JSON.stringify(notesData, null, 2);
    await fs.promises.writeFile(notesPath, jsonData, 'utf8');
    
    // Update our last known modification time
    const stat = await fs.promises.stat(notesPath);
    this.lastKnownModTime = stat.mtimeMs;
    notesData.metadata.fileModTime = stat.mtimeMs;
  }

  /**
   * Validate notes data structure
   */
  private isValidNotesData(data: any): data is NotesData {
    return (
      typeof data === 'object' &&
      typeof data.version === 'number' &&
      typeof data.lastModified === 'string' &&
      typeof data.deviceId === 'string' &&
      (data.state === 'editor' || data.state === 'render') &&
      typeof data.currentPage === 'number' &&
      Array.isArray(data.pages) &&
      typeof data.metadata === 'object' &&
      typeof data.metadata.totalPages === 'number' &&
      typeof data.metadata.createdAt === 'string'
    );
  }

  /**
   * Convert legacy webview state to new format
   */
  convertLegacyData(legacyData: LegacyNotesData): NotesData {
    const now = new Date().toISOString();

    return {
      version: 2, // New version
      lastModified: now,
      deviceId: this.deviceId,
      state: legacyData.state,
      currentPage: legacyData.currentPage,
      pages: legacyData.pages,
      bookmarks: new Array(legacyData.pages.length).fill(false), // Initialize bookmarks for legacy data
      metadata: {
        totalPages: legacyData.pages.length,
        createdAt: now,
        syncStatus: 'pending'
      }
    };
  }

  /**
   * Get list of available backups
   */
  async getBackupList(): Promise<Array<{ name: string; path: string; date: Date }>> {
    const backupDir = this.getBackupDirectoryPath();

    try {
      const files = await fs.promises.readdir(backupDir);
      const backupFiles = [];

      for (const file of files) {
        if (file.startsWith('backup-') && file.endsWith('.json')) {
          const filePath = path.join(backupDir, file);
          const stat = await fs.promises.stat(filePath);
          backupFiles.push({
            name: file,
            path: filePath,
            date: stat.mtime
          });
        }
      }

      return backupFiles.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Restore notes from a backup file
   */
  async restoreFromBackup(backupPath: string): Promise<NotesData> {
    const data = await fs.promises.readFile(backupPath, 'utf8');
    const notesData = JSON.parse(data) as NotesData;

    if (!this.isValidNotesData(notesData)) {
      throw new Error('Invalid backup data format');
    }

    // Save the restored data as current notes
    await this.saveNotes(notesData);

    return notesData;
  }

  /**
   * Toggle bookmark state for a specific note page
   * @param pageIndex - Index of the page to bookmark (0-based)
   * @param value - Optional explicit value; if omitted, toggles current state
   * @returns Updated NotesData or null if operation failed
   */
  async toggleBookmark(pageIndex: number, value?: boolean): Promise<NotesData | null> {
    const notesData = await this.loadNotes();

    if (!notesData) {
      console.warn('[StorageService] No notes data found for bookmark toggle');
      return null;
    }

    // Ensure bookmarks array exists and has correct length
    if (!notesData.bookmarks || notesData.bookmarks.length !== notesData.pages.length) {
      notesData.bookmarks = new Array(notesData.pages.length).fill(false);
    }

    // Validate page index
    if (pageIndex < 0 || pageIndex >= notesData.pages.length) {
      console.warn(`[StorageService] Invalid page index: ${pageIndex}`);
      return null;
    }

    // Toggle or set bookmark value
    notesData.bookmarks[pageIndex] = value !== undefined ? value : !notesData.bookmarks[pageIndex];

    console.log(`[StorageService] Bookmark toggled for page ${pageIndex}: ${notesData.bookmarks[pageIndex]}`);

    // Save updated notes
    await this.saveNotes(notesData);

    return notesData;
  }

  /**
   * Set bookmark state for multiple indices at once
   */
  async setBookmarks(indices: number[], value: boolean): Promise<NotesData | null> {
    const notesData = await this.loadNotes();

    if (!notesData) {
      console.warn('[StorageService] No notes data found for bulk bookmark toggle');
      return null;
    }

    if (!notesData.bookmarks || notesData.bookmarks.length !== notesData.pages.length) {
      notesData.bookmarks = new Array(notesData.pages.length).fill(false);
    }

    indices.forEach((idx) => {
      if (idx >= 0 && idx < notesData.pages.length) {
        notesData.bookmarks![idx] = value;
      }
    });

    await this.saveNotes(notesData);
    return notesData;
  }

  /**
   * Check if there's a potential sync conflict
   */
  async checkForConflicts(): Promise<{ hasConflict: boolean; remoteData?: NotesData; localData?: NotesData }> {
    const localData = await this.loadNotes();

    if (!localData) {
      return { hasConflict: false };
    }

    // In a real implementation, you might check against a remote source
    // For now, we'll check if the file was modified by a different device
    if (localData.deviceId !== this.deviceId) {
      return {
        hasConflict: true,
        remoteData: localData,
        localData: undefined // Would come from webview state
      };
    }

    return { hasConflict: false };
  }

  /**
   * Setup file system watcher to detect external changes
   */
  setupFileWatcher(onExternalChange: () => void): void {
    const notesPath = this.getNotesFilePath();
    
    // Dispose existing watcher if any
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    // Create a new file watcher
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      notesPath,
      false, // Don't ignore create events
      false, // Don't ignore change events
      false // Don't ignore delete events
    );

    // Watch for changes
    this.fileWatcher.onDidChange(async (uri) => {
      if (this.suppressFileWatcherEvents) {
        console.log('[StorageService] File change event suppressed (internal operation)');
        return;
      }
      
      try {
        const stat = await fs.promises.stat(uri.fsPath);
        
        // Only trigger if this is truly an external change
        if (stat.mtimeMs > this.lastKnownModTime) {
          console.log('[StorageService] External file change detected');
          this.lastKnownModTime = stat.mtimeMs;
          onExternalChange();
        }
      } catch (error) {
        console.warn('[StorageService] Error handling file change:', error);
      }
    });

    this.fileWatcher.onDidCreate(async () => {
      if (this.suppressFileWatcherEvents) {
        console.log('[StorageService] File create event suppressed (internal operation)');
        return;
      }
      
      console.log('[StorageService] Notes file created externally');
      onExternalChange();
    });

    this.fileWatcher.onDidDelete(() => {
      if (this.suppressFileWatcherEvents) {
        console.log('[StorageService] File delete event suppressed (internal operation)');
        return;
      }
      
      console.log('[StorageService] Notes file deleted externally');
      onExternalChange();
    });
  }

  /**
   * Dispose file watcher
   */
  disposeFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = undefined;
    }
  }

  /**
   * Check for and handle SyncThing conflict files
   */
  async checkForSyncThingConflicts(): Promise<string[]> {
    const storagePath = this.getStoragePath();
    const conflictFiles: string[] = [];

    try {
      const files = await fs.promises.readdir(storagePath);
      console.log(`[StorageService] Checking for conflicts in: ${storagePath}`);
      console.log(`[StorageService] Found ${files.length} files in directory`);
      
      for (const file of files) {
        // SyncThing creates conflict files with pattern: filename.sync-conflict-YYYYMMDD-HHMMSS-XXXXXXX.ext
        if (file.includes('sync-conflict') && file.includes('sidebar-notes')) {
          const fullPath = path.join(storagePath, file);
          conflictFiles.push(fullPath);
          console.log(`[StorageService] Found conflict file: ${file}`);
        }
      }
      
      if (conflictFiles.length === 0) {
        console.log('[StorageService] No SyncThing conflict files found');
      }
    } catch (error) {
      console.warn('[StorageService] Error checking for SyncThing conflicts:', error);
    }

    return conflictFiles;
  }

  /**
   * Resolve a SyncThing conflict by choosing between files
   */
  async resolveSyncThingConflict(conflictFilePath: string, useConflictVersion: boolean): Promise<void> {
    const notesPath = this.getNotesFilePath();

    if (useConflictVersion) {
      // Backup the current file
      await this.createBackup();
      
      // Replace with conflict file
      await fs.promises.copyFile(conflictFilePath, notesPath);
      
      // Delete the conflict file
      await fs.promises.unlink(conflictFilePath);
    } else {
      // Keep current version, just delete the conflict file
      // But first, backup the conflict file just in case
      await this.ensureBackupDirectory();
      const backupFileName = `conflict-backup-${path.basename(conflictFilePath)}`;
      const backupPath = path.join(this.getBackupDirectoryPath(), backupFileName);
      await fs.promises.copyFile(conflictFilePath, backupPath);
      
      // Delete the conflict file
      await fs.promises.unlink(conflictFilePath);
    }

    // Reload the file to update our state
    await this.loadNotes();
  }

  /**
   * Attempt to merge two versions of notes
   */
  async mergeNotes(localData: NotesData, remoteData: NotesData): Promise<NotesData> {
    // Simple merge strategy: combine unique pages
    const allPages = Array.from(new Set([...localData.pages, ...remoteData.pages]));

    // Use the more recent metadata
    const localTime = new Date(localData.lastModified).getTime();
    const remoteTime = new Date(remoteData.lastModified).getTime();
    const newerData = localTime > remoteTime ? localData : remoteData;

    // Create merged data
    const mergedData: NotesData = {
      version: Math.max(localData.version, remoteData.version),
      lastModified: new Date().toISOString(),
      deviceId: this.deviceId,
      state: newerData.state,
      currentPage: Math.min(newerData.currentPage, allPages.length - 1),
      pages: allPages,
      bookmarks: new Array(allPages.length).fill(false),
      metadata: {
        totalPages: allPages.length,
        createdAt: localData.metadata.createdAt || remoteData.metadata.createdAt,
        syncStatus: 'synced'
      }
    };

    // Try to preserve bookmarks where pages match
    const pageIndexMap = new Map(allPages.map((page, idx) => [page, idx]));
    
    // Merge bookmarks from both versions
    if (localData.bookmarks) {
      localData.pages.forEach((page, idx) => {
        const newIdx = pageIndexMap.get(page);
        if (newIdx !== undefined && localData.bookmarks![idx]) {
          mergedData.bookmarks![newIdx] = true;
        }
      });
    }
    
    if (remoteData.bookmarks) {
      remoteData.pages.forEach((page, idx) => {
        const newIdx = pageIndexMap.get(page);
        if (newIdx !== undefined && remoteData.bookmarks![idx]) {
          mergedData.bookmarks![newIdx] = true;
        }
      });
    }

    return mergedData;
  }

  /**
   * Get the device ID for this instance
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Temporarily suppress file watcher events (for internal operations)
   */
  setSuppressFileWatcher(suppress: boolean): void {
    this.suppressFileWatcherEvents = suppress;
    if (suppress) {
      console.log('[StorageService] File watcher events suppressed');
    } else {
      console.log('[StorageService] File watcher events re-enabled');
    }
  }
}
