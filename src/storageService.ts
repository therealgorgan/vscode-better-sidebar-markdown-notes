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
  async saveNotes(notesData: NotesData): Promise<void> {
    await this.ensureStorageDirectory();

    // Create backup before saving
    await this.createBackup();

    const notesPath = this.getNotesFilePath();

    // Update metadata
    notesData.lastModified = new Date().toISOString();
    notesData.deviceId = this.deviceId;
    notesData.metadata.totalPages = notesData.pages.length;

    const jsonData = JSON.stringify(notesData, null, 2);
    await fs.promises.writeFile(notesPath, jsonData, 'utf8');
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
}
