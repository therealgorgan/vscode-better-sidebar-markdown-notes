import * as vscode from 'vscode';

export interface StorageConfig {
  location: 'workspace' | 'custom';
  customPath: string;
  autoSave: boolean;
  autoSaveInterval: number;
}

export interface BackupConfig {
  enabled: boolean;
  maxBackups: number;
}

export interface SyncConfig {
  conflictResolution: 'timestamp' | 'manual';
}

class Config {
  private readonly config: vscode.WorkspaceConfiguration;

  constructor() {
    this.config = vscode.workspace.getConfiguration('better-sidebar-markdown-notes');
  }

  get leftMargin() {
    return !!this.config.get('leftMargin', false);
  }

  get storage(): StorageConfig {
    return {
      location: this.config.get('storage.location', 'workspace'),
      customPath: this.config.get('storage.customPath', ''),
      autoSave: this.config.get('storage.autoSave', true),
      autoSaveInterval: this.config.get('storage.autoSaveInterval', 1000)
    };
  }

  get backup(): BackupConfig {
    return {
      enabled: this.config.get('backup.enabled', true),
      maxBackups: this.config.get('backup.maxBackups', 10)
    };
  }

  get sync(): SyncConfig {
    return {
      conflictResolution: this.config.get('sync.conflictResolution', 'manual')
    };
  }
}

export function getConfig() {
  return new Config();
}
