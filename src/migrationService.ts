import * as vscode from 'vscode';
import { StorageService, NotesData, LegacyNotesData } from './storageService';

export class MigrationService {
  private readonly migrationKey = 'sidebar-notes-migrated';

  constructor(private context: vscode.ExtensionContext, private storageService: StorageService) {}

  /**
   * Check if migration has already been completed
   */
  private isMigrationCompleted(): boolean {
    return this.context.globalState.get(this.migrationKey, false);
  }

  /**
   * Mark migration as completed
   */
  private markMigrationCompleted(): void {
    this.context.globalState.update(this.migrationKey, true);
  }

  /**
   * Get legacy data from webview state (if available)
   */
  private getLegacyDataFromWebview(webview?: vscode.Webview): LegacyNotesData | null {
    if (!webview) {
      return null;
    }

    try {
      // In the current implementation, webview state is managed by the webview itself
      // We'll need to request it from the webview
      return null; // Will be handled differently in the webview integration
    } catch (error) {
      console.warn('Failed to get legacy data from webview:', error);
      return null;
    }
  }

  /**
   * Create a default notes structure
   */
  private createDefaultNotes(): NotesData {
    const now = new Date().toISOString();

    return {
      version: 2,
      lastModified: now,
      deviceId: '', // Will be set by storage service
      state: 'editor',
      currentPage: 0,
      pages: [''], // Start with one empty page instead of welcome message
      metadata: {
        totalPages: 1,
        createdAt: now,
        syncStatus: 'synced'
      }
    };
  }

  /**
   * Migrate legacy data to new file-based storage
   */
  async migrateLegacyData(legacyData?: LegacyNotesData): Promise<NotesData> {
    try {
      // Check if we already have file-based data
      const existingData = await this.storageService.loadNotes();
      if (existingData) {
        console.log('File-based notes already exist, skipping migration');
        this.markMigrationCompleted();
        return existingData;
      }

      let notesToMigrate: NotesData;

      if (legacyData) {
        // Convert legacy data to new format
        console.log('Migrating legacy webview data to file-based storage');
        notesToMigrate = this.storageService.convertLegacyData(legacyData);

        // Show migration notification
        vscode.window
          .showInformationMessage(
            'Sidebar Notes: Your notes have been migrated to file-based storage for better synchronization across devices.',
            'Learn More'
          )
          .then((selection) => {
            if (selection === 'Learn More') {
              vscode.env.openExternal(
                vscode.Uri.parse('https://github.com/therealgorgan/better-sidebar-markdown-notes#cloud-sync')
              );
            }
          });
      } else {
        // Create default notes
        console.log('No legacy data found, creating default notes');
        notesToMigrate = this.createDefaultNotes();
      }

      // Suppress file watcher events during initial save
      this.storageService.setSuppressFileWatcher(true);
      
      // Save the migrated data
      await this.storageService.saveNotes(notesToMigrate);
      
      // Re-enable file watcher after a short delay
      setTimeout(() => {
        this.storageService.setSuppressFileWatcher(false);
      }, 500);

      // Mark migration as completed
      this.markMigrationCompleted();

      console.log('Migration completed successfully');
      return notesToMigrate;
    } catch (error) {
      console.error('Migration failed:', error);

      // Show error notification
      vscode.window
        .showErrorMessage(
          'Failed to migrate notes to file-based storage. Using default notes.',
          'Retry',
          'Report Issue'
        )
        .then((selection) => {
          if (selection === 'Retry') {
            // Reset migration flag and try again
            this.context.globalState.update(this.migrationKey, false);
            this.migrateLegacyData(legacyData);
          } else if (selection === 'Report Issue') {
            vscode.env.openExternal(
              vscode.Uri.parse('https://github.com/therealgorgan/better-sidebar-markdown-notes/issues')
            );
          }
        });

      // Return default notes as fallback
      return this.createDefaultNotes();
    }
  }

  /**
   * Check if migration is needed and perform it
   */
  async checkAndMigrate(): Promise<NotesData> {
    if (this.isMigrationCompleted()) {
      // Migration already done, just load existing data
      const existingData = await this.storageService.loadNotes();
      if (existingData) {
        return existingData;
      }
    }

    // Migration needed - this will be called with legacy data from webview
    return this.migrateLegacyData();
  }

  /**
   * Force migration with specific legacy data
   */
  async forceMigration(legacyData: LegacyNotesData): Promise<NotesData> {
    // Reset migration flag
    this.context.globalState.update(this.migrationKey, false);

    return this.migrateLegacyData(legacyData);
  }

  /**
   * Reset migration state (for testing or troubleshooting)
   */
  async resetMigration(): Promise<void> {
    this.context.globalState.update(this.migrationKey, false);
    console.log('Migration state reset');
  }

  /**
   * Get migration status information
   */
  getMigrationStatus(): {
    isCompleted: boolean;
    hasFileBasedData: Promise<boolean>;
  } {
    return {
      isCompleted: this.isMigrationCompleted(),
      hasFileBasedData: this.storageService.loadNotes().then((data) => data !== null)
    };
  }

  /**
   * Create a backup of current webview state before migration
   */
  async createPreMigrationBackup(legacyData: LegacyNotesData): Promise<void> {
    try {
      const backupData = {
        ...legacyData,
        backupType: 'pre-migration',
        backupDate: new Date().toISOString()
      };

      // Store in extension's global state as a backup
      const existingBackups = this.context.globalState.get('pre-migration-backups', []) as any[];
      existingBackups.push(backupData);

      // Keep only the last 5 pre-migration backups
      const recentBackups = existingBackups.slice(-5);
      await this.context.globalState.update('pre-migration-backups', recentBackups);

      console.log('Pre-migration backup created');
    } catch (error) {
      console.warn('Failed to create pre-migration backup:', error);
    }
  }

  /**
   * Get pre-migration backups
   */
  getPreMigrationBackups(): any[] {
    return this.context.globalState.get('pre-migration-backups', []);
  }

  /**
   * Restore from pre-migration backup
   */
  async restoreFromPreMigrationBackup(backupIndex: number): Promise<LegacyNotesData | null> {
    const backups = this.getPreMigrationBackups();

    if (backupIndex < 0 || backupIndex >= backups.length) {
      throw new Error('Invalid backup index');
    }

    const backup = backups[backupIndex];

    // Remove backup-specific fields
    const { backupType: _backupType, backupDate: _backupDate, ...legacyData } = backup;

    // Reference the backup metadata to avoid unused variable lint warnings
    void _backupType;
    void _backupDate;

    return legacyData as LegacyNotesData;
  }
}
