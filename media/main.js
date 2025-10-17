/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
// @ts-nocheck

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
  // Gets the vs code api
  const vscode = acquireVsCodeApi();

  const log = (message) => vscode.postMessage({ type: 'log', value: message });

  const updateStatusBar = (message) => vscode.postMessage({ type: 'updateStatusBar', value: message });
  updateStatusBar('');

  let timeoutId;
  const updateStatusForSeconds = (message, secondsToHide) => {
    updateStatusBar(message);

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }

    timeoutId = setTimeout(() => {
      updateStatusBar('');
    }, secondsToHide || 3000);
  };

  const welcomeMessage =
    '# Welcome to `sidebar-markdown-notes`\n\nStart by typing **markdown**.\n\nClick the `Toggle preview` button to view your notes\n\nAlso works with GitHub Flavored Markdown ✨✨\n- [ ] Start by  \n- [ ] creating your own  \n- [x] checklists!  \n\nOr any kind of markdown\n\n- Your imagination  \n- Is the limit';

  const initialState = {
    state: 'editor',
    currentPage: 0,
    pages: [welcomeMessage],
    version: 1
  };

  // State management for file-based storage
  let currentState = initialState;
  let isInitialized = false;
  let autoSaveTimeout;
  let pendingSave = false;

  // Browse notes modal selection state
  let browserSelectedNotes = new Set(); // Set of selected note indices

  // Set the options for the maked markdown parser
  marked.setOptions({
    gfm: true,
    breaks: true
  });

  // Creates custom renderers for the marked markdown
  const renderer = {
    // Ref: https://github.com/markedjs/marked/blob/master/src/Renderer.js
    list(body, ordered, start) {
      const type = ordered ? 'ol' : 'ul',
        startatt = ordered && start !== 1 ? ' start="' + start + '"' : '',
        hasTodo = body.match(/checkbox/i) ? ' class="todoList"' : ''; // If there's a checkbox, adds a "todoList" class
      return '<' + type + startatt + hasTodo + '>\n' + body + '</' + type + '>\n';
    },
    checkbox(checked) {
      return '<input ' + (checked ? 'checked="" ' : '') + 'type="checkbox"' + (this.options.xhtml ? ' /' : '') + '> ';
    }
  };

  // Use the created renderer
  marked.use({ renderer });

  // This method will render the webview
  const renderView = () => {
    // Grabs the elements
    const renderElement = document.getElementById('render');
    const editorElement = document.getElementById('content');

    // Gets the latest markdown content
    const content = currentState.pages[currentState.currentPage];

    switch (currentState.state) {
      case 'render': {
        // If we want to render the markdown

        // Grab the html for the markdown
        renderElement.innerHTML = DOMPurify.sanitize(marked(content || ''));

        if (renderElement.classList.contains('hidden')) {
          renderElement.classList.remove('hidden');
        }
        editorElement.classList.add('hidden');

        document.querySelectorAll(`input[type='checkbox']`).forEach((check) => {
          // So we can lookup the checkbox in the markdown content
          const content = check.parentElement.textContent.trim();
          const getIsChecked = () => currentState.pages[currentState.currentPage].includes(`- [x] ${content}`);

          // Ensure the checkbox state matches what is in the latest markdown
          check.checked = getIsChecked();

          check.addEventListener('click', () => {
            const checked = getIsChecked();

            // Update the markdown to use the new checked state
            // Best to just rely on the markdown as the source of truth rather
            // than trying to juggle some internal state for the checkbox
            const newPageContent = checked
              ? // Was checked - should now uncheck
                currentState.pages[currentState.currentPage].replaceAll(`- [x] ${content}`, `- [ ] ${content}`)
              : // Was not checked - should now check
                currentState.pages[currentState.currentPage].replaceAll(`- [ ] ${content}`, `- [x] ${content}`);

            let newState = {
              ...currentState,
              pages: [
                ...currentState.pages.slice(0, currentState.currentPage),
                newPageContent,
                ...currentState.pages.slice(currentState.currentPage + 1)
              ]
            };

            saveState(newState);
          });
        });
        break;
      }
      case 'editor': {
        // If we want to render the text editor

        // Grabs the text input
        const editorTextArea = document.getElementById('text-input');

        // Put the value in the input
        editorTextArea.value = content || '';

        if (editorElement.classList.contains('hidden')) {
          editorElement.classList.remove('hidden');
        }
        renderElement.classList.add('hidden');
        break;
      }
    }
    
    // Update bookmark UI whenever view renders
    updateBookmarkUI();
  };

  // Convert current state to new file-based format
  const convertToFileFormat = (state) => {
    const now = new Date().toISOString();
    // Ensure bookmarks array exists and matches pages length
    const bookmarks = state.bookmarks && state.bookmarks.length === state.pages.length
      ? state.bookmarks
      : new Array(state.pages.length).fill(false);
    
    return {
      version: 2,
      lastModified: now,
      deviceId: '', // Will be set by backend
      state: state.state,
      currentPage: state.currentPage,
      pages: state.pages,
      bookmarks: bookmarks,
      metadata: {
        totalPages: state.pages.length,
        createdAt: now,
        syncStatus: 'pending'
      }
    };
  };

  // Convert file format to current state format
  const convertFromFileFormat = (fileData) => {
    // Ensure bookmarks array exists and matches pages length
    const bookmarks = fileData.bookmarks && fileData.bookmarks.length === fileData.pages.length
      ? fileData.bookmarks
      : new Array(fileData.pages.length).fill(false);
    
    return {
      state: fileData.state,
      currentPage: fileData.currentPage,
      pages: fileData.pages,
      bookmarks: bookmarks,
      version: fileData.version
    };
  };

  const saveState = (newState) => {
    // Updates current instance
    currentState = newState;
    renderView();

    // Save to file-based storage if initialized
    if (isInitialized) {
      scheduleAutoSave(newState);
    }
  };

  // UI Elements
  let saveButton;
  let saveStatus;

  // Save status management
  const updateSaveStatus = (status, message) => {
    if (!saveStatus) {
      return;
    }

    saveStatus.className = `save-status ${status}`;
    saveStatus.textContent = message;

    // Clear status after a delay (except for errors)
    if (status !== 'error') {
      setTimeout(() => {
        if (saveStatus.className.includes(status)) {
          saveStatus.textContent = '';
          saveStatus.className = 'save-status';
        }
      }, 3000);
    }
  };

  // Schedule auto-save with debouncing (increased to 2-3 seconds)
  const scheduleAutoSave = (state) => {
    if (pendingSave) {
      return;
    }

    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }

    // Show auto-save pending status
    updateSaveStatus('saving', 'Auto-saving...');

    autoSaveTimeout = setTimeout(() => {
      saveToFile(state, true); // true indicates auto-save
    }, 2500); // 2.5 second debounce for better UX
  };

  // Save state to file
  const saveToFile = (state, isAutoSave = false) => {
    if (pendingSave) {
      return;
    }

    pendingSave = true;

    // Update UI
    if (saveButton) {
      saveButton.disabled = true;
    }

    if (!isAutoSave) {
      updateSaveStatus('saving', 'Saving...');
    }

    const fileData = convertToFileFormat(state);

    vscode.postMessage({
      type: 'saveNotes',
      value: fileData,
      isAutoSave: isAutoSave
    });

    // Reset pending flag after a delay
    setTimeout(() => {
      pendingSave = false;
      if (saveButton) {
        saveButton.disabled = false;
      }
    }, 500);
  };

  // Manual save function
  const manualSave = () => {
    if (pendingSave) {
      return;
    }

    // Clear any pending auto-save
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = null;
    }

    saveToFile(currentState, false);
  };

  // Load initial data from file
  const loadInitialData = () => {
    vscode.postMessage({ type: 'requestInitialData' });
  };

  const getUpdatedContent = () => {
    let newState = { ...currentState };

    switch (currentState.state) {
      case 'render': {
        break;
      }
      case 'editor': {
        // If the current state is the editor

        // Get the editor text area
        const editorTextArea = document.getElementById('text-input');

        // Updates the value in state only if they're different
        if (editorTextArea.value !== newState.pages[newState.currentPage]) {
          // Make a state with the typed in value
          newState = {
            ...newState,
            pages: [
              ...newState.pages.slice(0, newState.currentPage),
              editorTextArea.value,
              ...newState.pages.slice(newState.currentPage + 1)
            ]
          };
        }

        break;
      }
    }

    return newState;
  };

  const debouncedSaveContent = _.debounce(() => saveState(getUpdatedContent()), 300, {
    maxWait: 500
  });

  const togglePreview = () => {
    // Grabs the new state
    let newState = { ...getUpdatedContent(), state: currentState.state === 'editor' ? 'render' : 'editor' };
    saveState(newState);
  };

  const exportPage = () => {
    // Update state and get current page's content
    let newState = getUpdatedContent();
    saveState(newState);
    const content = newState.pages[newState.currentPage];
    // Reply to extension with the text
    vscode.postMessage({ type: 'exportPage', value: content });
  };

  const previousPage = () => {
    if (currentState.currentPage > 0) {
      let newState = { ...getUpdatedContent(), currentPage: currentState.currentPage - 1 };

      saveState(newState);

      updateStatusForSeconds(`$(file) Page ${newState.currentPage + 1}`);
    } else {
      updateStatusForSeconds(`$(file) Page ${currentState.currentPage + 1}`);
      log(`You're already at the first page`);
    }
  };

  const nextPage = () => {
    if (currentState.currentPage <= 999) {
      const newPageIndex = Number(currentState.currentPage) + 1;

      let newState = {
        ...getUpdatedContent(),
        currentPage: newPageIndex
      };

      if (!currentState.pages[newPageIndex]) {
        newState = { ...newState, pages: [...newState.pages, `Page ${newPageIndex + 1}\n${welcomeMessage}`] };
      }

      saveState(newState);

      updateStatusForSeconds(`$(file) Page ${newPageIndex + 1}`);
    }
  };

  // Handle messages sent from the extension to the webview
  window.addEventListener('message', (event) => {
    const message = event.data; // The json data that the extension sent
    switch (message.type) {
      case 'openImportModal': {
        // Open the import modal and start scanning
        openImportModal();
        break;
      }
      case 'closeImportModal': {
        // Close the import modal and reset state
        closeImportModal();
        break;
      }
      case 'togglePreview': {
        // If the editor sends a togglePreview message
        togglePreview();
        break;
      }
      case 'previousPage': {
        previousPage();
        break;
      }
      case 'nextPage': {
        nextPage();
        break;
      }
      case 'resetData': {
        saveState(initialState);
        break;
      }
      case 'exportPage': {
        exportPage();
        break;
      }
      case 'initialData': {
        // Received initial data from file storage
        if (message.data) {
          currentState = convertFromFileFormat(message.data);
          isInitialized = true;
          showNoWorkspaceMessage(false);
          renderView();
        } else {
          // No file data, check for legacy webview state
          const legacyState = vscode.getState();
          if (legacyState && legacyState.pages) {
            // Migrate legacy data
            vscode.postMessage({
              type: 'migrateLegacyData',
              value: legacyState
            });
          } else {
            // Use initial state
            currentState = initialState;
            isInitialized = true;
            showNoWorkspaceMessage(false);
            renderView();
            saveToFile(currentState);
          }
        }
        break;
      }
      case 'noWorkspace': {
        // Show no workspace message
        showNoWorkspaceMessage(true);
        break;
      }
      case 'workspaceOpened': {
        // Workspace was opened, hide message and reload
        showNoWorkspaceMessage(false);
        loadInitialData();
        break;
      }
      case 'customLocationSelected': {
        // Custom location was selected, hide message and reload
        showNoWorkspaceMessage(false);
        loadInitialData();
        break;
      }
      case 'notesLoaded': {
        // Notes loaded from file
        if (message.data) {
          currentState = convertFromFileFormat(message.data);
          isInitialized = true;
          renderView();
        }
        break;
      }
      case 'notesRestored': {
        // Notes restored from backup
        if (message.data) {
          currentState = convertFromFileFormat(message.data);
          isInitialized = true;
          renderView();
        }
        break;
      }
      case 'migrationComplete': {
        // Migration completed
        if (message.data) {
          currentState = convertFromFileFormat(message.data);
          isInitialized = true;
          renderView();
        }
        break;
      }
      case 'saveSuccess': {
        // Handle successful save
        const isAutoSave = message.isAutoSave;
        if (isAutoSave) {
          updateSaveStatus('saved', 'Auto-saved');
        } else {
          updateSaveStatus('saved', 'Saved successfully');
        }
        break;
      }
      case 'saveError': {
        // Handle save error
        console.error('Save error:', message.error);
        updateSaveStatus('error', `Save failed: ${message.error}`);
        break;
      }
      case 'loadError': {
        // Handle load error
        console.error('Load error:', message.error);
        updateSaveStatus('error', `Load failed: ${message.error}`);
        break;
      }
      case 'notesDiscovered': {
        // Handle discovered notes from import scan
        handleNotesDiscovered(message.data);
        break;
      }
      case 'importResult': {
        // Handle import result
        handleImportResult(message.data);
        break;
      }
      case 'bookmarkToggled': {
        // Handle bookmark toggle response from extension
        if (message.data) {
          currentState = convertFromFileFormat(message.data);
          updateBookmarkUI();
          // Update bookmark icons in browse notes modal if it's open
          const modal = document.getElementById('note-browser-modal');
          if (modal && !modal.classList.contains('hidden')) {
            updateBrowserBookmarkIcons();
          }
        }
        break;
      }
    }
  });

  document.getElementById('text-input').addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      // prevent the focus lose on tab press
      event.preventDefault();
    }
  });

  document.getElementById('text-input').addEventListener('input', () => {
    debouncedSaveContent();

    // Trigger auto-save if initialized
    if (isInitialized) {
      scheduleAutoSave(currentState);
    }
  });

  // Show/hide no-workspace message
  const showNoWorkspaceMessage = (show) => {
    const noWorkspaceMessage = document.getElementById('no-workspace-message');
    const content = document.getElementById('content');
    const render = document.getElementById('render');
    const toolbar = document.getElementById('toolbar');

    if (show) {
      noWorkspaceMessage.classList.remove('hidden');
      content.classList.add('hidden');
      render.classList.add('hidden');
      toolbar.classList.add('hidden');
    } else {
      noWorkspaceMessage.classList.add('hidden');
      content.classList.remove('hidden');
      render.classList.remove('hidden');
      toolbar.classList.remove('hidden');
    }
  };

  // Handle workspace actions
  const handleOpenWorkspace = () => {
    vscode.postMessage({ type: 'openWorkspace' });
  };

  const handleSelectLocation = () => {
    vscode.postMessage({ type: 'selectCustomLocation' });
  };

  // Note Browser Functionality
  const openNoteBrowser = () => {
    updateNoteBrowser();
    const modal = document.getElementById('note-browser-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  };

  const closeNoteBrowser = () => {
    const modal = document.getElementById('note-browser-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    // Clear selection when closing
    browserSelectedNotes.clear();
  };

  const updateNoteBrowser = () => {
    const notesList = document.getElementById('notes-list');
    const noteCounter = document.getElementById('note-counter');
    const prevButton = document.getElementById('prev-note-nav');
    const nextButton = document.getElementById('next-note-nav');

    if (!notesList || !noteCounter) {
      return;
    }

    // Update counter and navigation buttons
    const totalNotes = currentState.pages.length;
    const currentNote = currentState.currentPage + 1;
    noteCounter.textContent = `${currentNote} of ${totalNotes}`;

    if (prevButton) {
      prevButton.disabled = currentState.currentPage === 0;
    }
    if (nextButton) {
      nextButton.disabled = currentState.currentPage >= totalNotes - 1;
    }

    // Clear existing notes
    notesList.innerHTML = '';

    if (totalNotes === 0) {
      notesList.innerHTML = `
        <div class="empty-notes">
          <div class="codicon codicon-file-text"></div>
          <h4>No Notes Found</h4>
          <p>Start by creating your first note</p>
        </div>
      `;
      return;
    }

    // Ensure bookmarks array exists
    if (!currentState.bookmarks || currentState.bookmarks.length !== currentState.pages.length) {
      currentState.bookmarks = new Array(currentState.pages.length).fill(false);
    }

    // Get bookmark filter value
    const bookmarkFilter = document.getElementById('bookmark-filter-select');
    const filterValue = bookmarkFilter ? bookmarkFilter.value : 'all';

    // Generate note items
    currentState.pages.forEach((page, index) => {
      // Apply bookmark filter
      if (filterValue === 'bookmarked' && !currentState.bookmarks[index]) {
        return; // Skip non-bookmarked notes
      }

      const noteItem = document.createElement('div');
      noteItem.className = `note-item ${index === currentState.currentPage ? 'active' : ''}`;
      
      // Extract title from first line or use default
      const lines = page.split('\n');
      const firstLine = lines[0] || '';
      let title = firstLine.replace(/^#+\s*/, '').trim() || `Note ${index + 1}`;
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }

      // Create preview from content (skip markdown headers)
      const contentLines = lines.filter((line) => !line.trim().startsWith('#'));
      const preview = contentLines.slice(0, 3).join('\n').trim() || 'Empty note';
      const previewText = preview.length > 120 ? preview.substring(0, 117) + '...' : preview;

      // Calculate character count
      const charCount = page.length;
      const wordCount = page.split(/\s+/).filter((word) => word.length > 0).length;

      // Check if note is bookmarked
      const isBookmarked = currentState.bookmarks[index] || false;

      noteItem.innerHTML = `
        <div class="note-item-inner">
          <div class="note-bookmark-container">
            <button class="bookmark-note-button ${isBookmarked ? 'bookmarked' : ''}" title="${isBookmarked ? 'Remove bookmark' : 'Bookmark note'}" data-index="${index}">
              <svg class="star-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 1L10.163 5.381L15 6.134L11.5 9.548L12.326 14.366L8 12.096L3.674 14.366L4.5 9.548L1 6.134L5.837 5.381L8 1Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="${isBookmarked ? '#FFEA00' : 'none'}"/>
              </svg>
            </button>
          </div>
          <div class="note-content" data-index="${index}">
            <div class="note-title">
              <span class="codicon codicon-file-text"></span>
              ${escapeHtml(title)}
            </div>
            <div class="note-preview">${escapeHtml(previewText)}</div>
            <div class="note-meta">
              <span class="note-length">${wordCount} words, ${charCount} chars</span>
              <span class="note-number">Page ${index + 1}</span>
            </div>
          </div>
          <div class="note-checkbox-container">
            <input type="checkbox" class="note-checkbox" data-index="${index}" ${browserSelectedNotes.has(index) ? 'checked' : ''} />
          </div>
        </div>
        <div class="note-actions">
          <button class="delete-note-button" title="Delete note" data-index="${index}">
            <span class="codicon codicon-trash"></span>
          </button>
        </div>
      `;
      
      // Handle checkbox selection
      const checkbox = noteItem.querySelector('.note-checkbox');
      if (checkbox) {
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation();
          if (checkbox.checked) {
            browserSelectedNotes.add(index);
          } else {
            browserSelectedNotes.delete(index);
          }
          updateBrowserSelectionUI();
        });
      }

      // Handle clicking note content to navigate
      const noteContent = noteItem.querySelector('.note-content');
      if (noteContent) {
        noteContent.addEventListener('click', () => {
          switchToNote(index);
          closeNoteBrowser();
        });
      }

      // Wire up bookmark button
      const bookmarkBtn = noteItem.querySelector('.bookmark-note-button');
      if (bookmarkBtn) {
        bookmarkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Toggle bookmark for this note
          vscode.postMessage({
            type: 'toggleBookmark',
            pageIndex: index
          });
        });
      }

      // Wire up delete button and prevent click from bubbling to noteItem
      const deleteBtn = noteItem.querySelector('.delete-note-button');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteNote(index);
        });
      }

      notesList.appendChild(noteItem);
    });

    // Update selection UI
    updateBrowserSelectionUI();
  };

  /**
   * Update bookmark star icons in the browser list without rebuilding entire list
   */
  const updateBrowserBookmarkIcons = () => {
    // Ensure bookmarks array exists
    if (!currentState.bookmarks || currentState.bookmarks.length !== currentState.pages.length) {
      currentState.bookmarks = new Array(currentState.pages.length).fill(false);
    }

    // Update each bookmark button
    document.querySelectorAll('.bookmark-note-button').forEach((btn) => {
      const index = parseInt(btn.dataset.index, 10);
      if (index >= 0 && index < currentState.bookmarks.length) {
        const isBookmarked = currentState.bookmarks[index] || false;
        const starPath = btn.querySelector('.star-icon path');
        
        if (isBookmarked) {
          btn.classList.add('bookmarked');
          btn.title = 'Remove bookmark';
          if (starPath) {
            starPath.setAttribute('fill', '#FFEA00');
          }
        } else {
          btn.classList.remove('bookmarked');
          btn.title = 'Bookmark note';
          if (starPath) {
            starPath.setAttribute('fill', 'none');
          }
        }
      }
    });
  };

  const navigateNote = (direction) => {
    const newPage = currentState.currentPage + direction;
    if (newPage >= 0 && newPage < currentState.pages.length) {
      switchToNote(newPage);
      updateNoteBrowser();
    }
  };

  const switchToNote = (pageIndex) => {
    if (pageIndex >= 0 && pageIndex < currentState.pages.length) {
      currentState.currentPage = pageIndex;
      const textInput = document.getElementById('text-input');
      if (textInput) {
        textInput.value = currentState.pages[pageIndex];
      }
      renderView();
      saveToFile(currentState, true); // Auto-save when switching notes
    }
  };

  /**
   * Update browser selection UI (count and delete button visibility)
   */
  const updateBrowserSelectionUI = () => {
    const selectionCount = document.getElementById('browser-selection-count');
    const deleteSelectedFooterBtn = document.getElementById('delete-selected-notes-footer');
    
    if (selectionCount) {
      const count = browserSelectedNotes.size;
      selectionCount.textContent = `${count} selected`;
    }
    
    if (deleteSelectedFooterBtn) {
      if (browserSelectedNotes.size > 0) {
        deleteSelectedFooterBtn.classList.remove('hidden');
      } else {
        deleteSelectedFooterBtn.classList.add('hidden');
      }
    }
  };

  /**
   * Select all visible notes in browser (respects current filter)
   */
  const browserSelectAll = () => {
    // Get currently visible note items
    const visibleCheckboxes = document.querySelectorAll('#notes-list .note-checkbox');
    visibleCheckboxes.forEach((checkbox) => {
      const index = parseInt(checkbox.dataset.index, 10);
      browserSelectedNotes.add(index);
      checkbox.checked = true;
    });
    updateBrowserSelectionUI();
  };

  /**
   * Deselect all notes in browser
   */
  const browserDeselectAll = () => {
    browserSelectedNotes.clear();
    document.querySelectorAll('#notes-list .note-checkbox').forEach((checkbox) => {
      checkbox.checked = false;
    });
    updateBrowserSelectionUI();
  };

  /**
   * Bulk set bookmarks for selected notes
   */
  const bulkSetBookmarks = (value) => {
    if (browserSelectedNotes.size === 0) {
      return;
    }
    const indices = Array.from(browserSelectedNotes);
    vscode.postMessage({ type: 'bulkSetBookmarks', indices, value });
  };

  /**
   * Delete selected notes from browser
   */
  const deleteSelectedNotes = () => {
    if (browserSelectedNotes.size === 0) {
      return;
    }

    const count = browserSelectedNotes.size;
    const message = `Delete ${count} selected note${count > 1 ? 's' : ''}? This cannot be undone.`;

    openConfirm('Delete selected notes', message).then((confirmed) => {
      if (!confirmed) {
        return;
      }

      // Sort indices in descending order to delete from end first
      const indicesToDelete = Array.from(browserSelectedNotes).sort((a, b) => b - a);
      
      // Capture deleted content for potential undo (not used yet)

      // Delete from end to preserve indices
      indicesToDelete.forEach((index) => {
        currentState.pages.splice(index, 1);
        if (currentState.bookmarks) {
          currentState.bookmarks.splice(index, 1);
        }
      });

      // Clear selection
      browserSelectedNotes.clear();

      // Ensure currentPage stays in bounds
      if (currentState.currentPage >= currentState.pages.length) {
        currentState.currentPage = Math.max(0, currentState.pages.length - 1);
      }

      renderView();
      updateNoteBrowser();
      saveToFile(currentState, false);
      updateStatusForSeconds(`${count} note${count > 1 ? 's' : ''} deleted`, 2000);
    });
  };

  const addNewNote = () => {
    const newPageContent = '# New Note\n\nStart writing your new note here...';
    currentState.pages.push(newPageContent);
    currentState.currentPage = currentState.pages.length - 1;
    
    // Initialize bookmark for new note
    if (!currentState.bookmarks) {
      currentState.bookmarks = new Array(currentState.pages.length).fill(false);
    } else {
      currentState.bookmarks.push(false);
    }
    
    const textInput = document.getElementById('text-input');
    if (textInput) {
      textInput.value = newPageContent;
      // Focus and select the title text for easy editing
      setTimeout(() => {
        textInput.focus();
        textInput.setSelectionRange(2, 10); // Select "New Note"
      }, 100);
    }
    
    renderView();
    updateNoteBrowser();
    updateBookmarkUI();
    saveToFile(currentState, true);
    updateStatusForSeconds('New note created', 2000);
  };

  /**
   * Toggle bookmark for the current note
   */
  const toggleBookmark = () => {
    const pageIndex = currentState.currentPage;
    vscode.postMessage({
      type: 'toggleBookmark',
      pageIndex: pageIndex
    });
  };

  /**
   * Update bookmark button UI based on current note's bookmark status
   */
  const updateBookmarkUI = () => {
    const bookmarkButton = document.getElementById('bookmark-note');
    if (!bookmarkButton) {
      return;
    }

    // Ensure bookmarks array exists and is correct length
    if (!currentState.bookmarks || currentState.bookmarks.length !== currentState.pages.length) {
      currentState.bookmarks = new Array(currentState.pages.length).fill(false);
    }

    const isBookmarked = currentState.bookmarks[currentState.currentPage] || false;
    const starIcon = bookmarkButton.querySelector('.star-icon path');
    
    if (isBookmarked) {
      bookmarkButton.classList.add('bookmarked');
      bookmarkButton.title = 'Remove bookmark';
      if (starIcon) {
        starIcon.setAttribute('fill', '#FFEA00');
      }
    } else {
      bookmarkButton.classList.remove('bookmarked');
      bookmarkButton.title = 'Bookmark this note';
      if (starIcon) {
        starIcon.setAttribute('fill', 'none');
      }
    }
  };

  const deleteNote = (index) => {
    if (index < 0 || index >= currentState.pages.length) {
      return;
    }

    const title = (currentState.pages[index] || '').split('\n')[0] || `Note ${index + 1}`;
    const message = `Delete "${title.replace(/\"/g, '\\"')}"? This cannot be undone.`;

    openConfirm('Delete note', message).then((confirmed) => {
      if (!confirmed) {
        return;
      }

      // Capture deleted content for undo
      const deletedContent = currentState.pages[index];
      const deletedIndex = index;

      // Remove the page
      currentState.pages.splice(index, 1);

      // Ensure currentPage stays in bounds
      if (currentState.currentPage >= currentState.pages.length) {
        currentState.currentPage = Math.max(0, currentState.pages.length - 1);
      }

      renderView();
      updateNoteBrowser();
      saveToFile(currentState, false);
      updateStatusForSeconds('Note deleted', 2000);

      // Show undo toast
      showToast('Note deleted', 'Undo', () => {
        // Restore at original index
        currentState.pages.splice(deletedIndex, 0, deletedContent);
        currentState.currentPage = deletedIndex;
        renderView();
        updateNoteBrowser();
        saveToFile(currentState, false);
        updateStatusForSeconds('Delete undone', 2000);
      });
    });
  };

  // Removed deleteAllNotes in favor of Delete Selected

  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Import functionality
  let discoveredNotes = [];
  let selectedNotes = new Set();
  // let importConflicts = [];
  // Guard to avoid race where the modal is opened then immediately closed
  // because the extension quickly posts a close message (e.g. user cancelled
  // folder selection). We only allow close after the modal has been marked
  // as fully open.
  let importModalOpen = false;
  let importScanDelayId;
  // Allow close only after a short grace period to avoid races
  let importModalAllowClose = false;
  let importAllowCloseTimer;

  const openImportModal = () => {
    const modal = document.getElementById('import-notes-modal');
    if (modal) {
      // Mark as opening immediately so close handlers know not to act
      importModalOpen = true;
      modal.classList.remove('hidden');
      showImportSection('import-scanning');
      // Prevent immediate closes that race with opening; enable close after a short delay
      importModalAllowClose = false;
      if (importAllowCloseTimer) {
        clearTimeout(importAllowCloseTimer);
      }
      importAllowCloseTimer = setTimeout(() => {
        importModalAllowClose = true;
        importAllowCloseTimer = undefined;
      }, 300);
      // NOTE: We no longer automatically send scanForNotes here because
      // the extension now handles path selection and scanning BEFORE opening
      // the modal (to avoid Quick Pick and modal competing for focus).
      // The extension calls startNoteScan() before sending openImportModal.
    }
  };

  const closeImportModal = () => {
    const modal = document.getElementById('import-notes-modal');
    if (modal) {
      // Only allow closing if the modal was fully opened and the grace period
      // has passed. This prevents an immediate close triggered by the extension
      // while we're still rendering/opening the modal.
      if (!importModalOpen || !importModalAllowClose) {
        return;
      }

      modal.classList.add('hidden');
      importModalOpen = false;
      importModalAllowClose = false;
      if (importScanDelayId) {
        clearTimeout(importScanDelayId);
        importScanDelayId = undefined;
      }
      if (importAllowCloseTimer) {
        clearTimeout(importAllowCloseTimer);
        importAllowCloseTimer = undefined;
      }
      resetImportState();
    }
  };

  // Custom confirmation modal that returns a Promise<boolean>
  const openConfirm = (title, message) => {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      const confirmTitle = document.getElementById('confirm-title');
      const confirmMessage = document.getElementById('confirm-message');
      const yesBtn = document.getElementById('confirm-yes');
      const noBtn = document.getElementById('confirm-no');

      if (!modal || !confirmTitle || !confirmMessage || !yesBtn || !noBtn) {
        // Fallback to native confirm if elements are missing
        resolve(window.confirm(message));
        return;
      }

      confirmTitle.textContent = title || 'Confirm';
      confirmMessage.textContent = message || '';

      const cleanup = () => {
        modal.classList.add('hidden');
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
      };

      const onYes = () => {
        cleanup();
        resolve(true);
      };

      const onNo = () => {
        cleanup();
        resolve(false);
      };

      yesBtn.addEventListener('click', onYes);
      noBtn.addEventListener('click', onNo);

      modal.classList.remove('hidden');
    });
  };

  // Show a transient toast with an optional action button (e.g., Undo)
  const showToast = (message, actionLabel, actionCallback, timeout = 6000) => {
    const container = document.getElementById('toast-container');
    if (!container) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <div class="toast-message">${escapeHtml(message)}</div>
      <div class="toast-actions"></div>
    `;

    const actions = toast.querySelector('.toast-actions');
    if (actionLabel && actions) {
      const actionBtn = document.createElement('button');
      actionBtn.className = 'primary-button';
      actionBtn.textContent = actionLabel;
      actionBtn.addEventListener('click', () => {
        try {
          actionCallback && actionCallback();
        } finally {
          container.removeChild(toast);
        }
      });
      actions.appendChild(actionBtn);
    }

    container.appendChild(toast);

    // Auto-remove after timeout
    const id = setTimeout(() => {
      if (container.contains(toast)) {
        container.removeChild(toast);
      }
      clearTimeout(id);
    }, timeout);
  };

  const resetImportState = () => {
    discoveredNotes = [];
    selectedNotes.clear();
    // importConflicts = [];

    // Hide all sections
    document.querySelectorAll('.import-section').forEach((section) => {
      section.classList.add('hidden');
    });

    // Hide all footer buttons except cancel
    document.querySelectorAll('.modal-footer .primary-button').forEach((btn) => {
      btn.classList.add('hidden');
    });
  };

  const showImportSection = (sectionId) => {
    // Hide all sections first
    document.querySelectorAll('.import-section').forEach((section) => {
      section.classList.add('hidden');
    });

    // Show the requested section
    const section = document.getElementById(sectionId);
    if (section) {
      section.classList.remove('hidden');
    }
  };

  const handleNotesDiscovered = (data) => {
    discoveredNotes = data.notes;
    selectedNotes.clear();

    showImportSection('import-selection');
    populateDiscoveredNotes();
    updateImportStats();

    // Show import button
    const importBtn = document.getElementById('import-selected-notes');
    if (importBtn) {
      importBtn.classList.remove('hidden');
    }

    // Setup filter
    const filterSelect = document.getElementById('note-filter');
    if (filterSelect) {
      filterSelect.value = 'all';
      filterSelect.addEventListener('change', () => {
        populateDiscoveredNotes();
      });
    }
  };

  const populateDiscoveredNotes = () => {
    const notesList = document.getElementById('discovered-notes-list');
    if (!notesList) {
      return;
    }

    notesList.innerHTML = '';

    // Get current filter
    const filterSelect = document.getElementById('note-filter');
    const filterValue = filterSelect ? filterSelect.value : 'all';

    // Filter notes based on selection
    const filteredNotes = discoveredNotes.filter((note) => {
      if (filterValue === 'all') {
        return true;
      }
      if (filterValue === 'old-extension') {
        // Match notes from old extension (marked with isOldExtensionNote flag)
        return note.isOldExtensionNote === true;
      }
      if (filterValue === 'workspace') {
        // Match notes from workspace markdown files (not from old extension)
        return note.isOldExtensionNote !== true && note.source && note.source.toLowerCase().includes('workspace');
      }
      return true;
    });

    filteredNotes.forEach((note) => {
      // Get original index for selection tracking
      const originalIndex = discoveredNotes.indexOf(note);

      const noteItem = document.createElement('div');
      noteItem.className = 'discovered-note-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `note-${originalIndex}`;
      checkbox.dataset.index = String(originalIndex);
      checkbox.checked = selectedNotes.has(originalIndex);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedNotes.add(originalIndex);
        } else {
          selectedNotes.delete(originalIndex);
        }
        updateImportStats();
      });

      const label = document.createElement('label');
      label.htmlFor = `note-${originalIndex}`;
      label.className = 'note-label';

      const title = note.fileName || 'Untitled';
      const preview = note.preview || 'No preview available';
      const stats = `${note.wordCount} words, ${formatFileSize(note.size)}`;
      const lastModified = new Date(note.lastModified).toLocaleDateString();
      const source = note.source ? `<span class="note-source">${escapeHtml(note.source)}</span>` : '';

      label.innerHTML = `
        <div class="note-title">${escapeHtml(title)} ${source}</div>
        <div class="note-preview">${escapeHtml(preview)}</div>
        <div class="note-meta">
          <span class="note-stats">${stats}</span>
          <span class="note-date">Modified: ${lastModified}</span>
          <span class="note-path">${escapeHtml(note.relativePath)}</span>
        </div>
      `;

      noteItem.appendChild(checkbox);
      noteItem.appendChild(label);
      notesList.appendChild(noteItem);
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const updateImportStats = () => {
    const foundCount = document.getElementById('notes-found-count');
    const selectedCount = document.getElementById('notes-selected-count');

    if (foundCount) {
      foundCount.textContent = `${discoveredNotes.length} notes found`;
    }

    if (selectedCount) {
      selectedCount.textContent = `${selectedNotes.size} selected`;
    }
  };

  const selectAllNotes = () => {
    // Select only currently visible (filtered) items
    const visibleCheckboxes = document.querySelectorAll('#discovered-notes-list input[type="checkbox"]');
    visibleCheckboxes.forEach((checkbox) => {
      const idx = parseInt(checkbox.dataset.index || '-1', 10);
      if (idx >= 0) {
        selectedNotes.add(idx);
        checkbox.checked = true;
      }
    });
    updateImportStats();
  };

  const deselectAllNotes = () => {
    // Deselect only currently visible (filtered) items
    const visibleCheckboxes = document.querySelectorAll('#discovered-notes-list input[type="checkbox"]');
    visibleCheckboxes.forEach((checkbox) => {
      const idx = parseInt(checkbox.dataset.index || '-1', 10);
      if (idx >= 0) {
        selectedNotes.delete(idx);
        checkbox.checked = false;
      }
    });
    updateImportStats();
  };

  const importSelectedNotes = () => {
    if (selectedNotes.size === 0) {
      return;
    }

      const notesToImport = Array.from(selectedNotes).map((index) => discoveredNotes[index]);

    // Send import request to extension
    vscode.postMessage({
      type: 'importSelectedNotes',
      value: {
        selectedNotes: notesToImport,
        conflictResolutions: new Map() // TODO: Handle conflicts
      }
    });

    showImportSection('import-scanning');
  };

  const handleImportResult = (result) => {
    showImportSection('import-results');

    const summaryStats = document.getElementById('import-summary-stats');
    if (summaryStats) {
      let html = `
        <div class="import-stat">
          <span class="stat-label">Imported:</span>
          <span class="stat-value">${result.imported}</span>
        </div>
      `;

      if (result.skipped > 0) {
        html += `
          <div class="import-stat">
            <span class="stat-label">Skipped:</span>
            <span class="stat-value">${result.skipped}</span>
          </div>
        `;
      }

      if (result.errors.length > 0) {
        html += `
          <div class="import-stat error">
            <span class="stat-label">Errors:</span>
            <span class="stat-value">${result.errors.length}</span>
          </div>
        `;

        html += '<div class="import-errors"><h5>Errors:</h5><ul>';
        result.errors.forEach((error) => {
          html += `<li>${escapeHtml(error)}</li>`;
        });
        html += '</ul></div>';
      }

      summaryStats.innerHTML = html;
    }

    // Show finish button
    const finishBtn = document.getElementById('finish-import-btn');
    if (finishBtn) {
      finishBtn.classList.remove('hidden');
    }

    // Hide import button
    const importBtn = document.getElementById('import-selected-notes');
    if (importBtn) {
      importBtn.classList.add('hidden');
    }
  };

  // Initialize the application
  const initialize = () => {
    // Initialize UI elements
    saveButton = document.getElementById('save-button');
    saveStatus = document.getElementById('save-status');

    // Add save button event listener
    if (saveButton) {
      saveButton.addEventListener('click', manualSave);
    }

    // Add options button event listener
    const optionsButton = document.getElementById('options-button');
    if (optionsButton) {
      optionsButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
      });
    }

    // Add note browser event listeners
    const browseNotesButton = document.getElementById('browse-notes-button');
    const noteBrowserModal = document.getElementById('note-browser-modal');
    const closeBrowserButton = document.getElementById('close-browser');
    const prevNoteNav = document.getElementById('prev-note-nav');
    const nextNoteNav = document.getElementById('next-note-nav');
    // Toolbar navigation arrows (visible in main toolbar)
    const prevNoteToolbar = document.getElementById('prev-note-toolbar');
    const nextNoteToolbar = document.getElementById('next-note-toolbar');
    const addNewNoteButton = document.getElementById('add-new-note');

    if (browseNotesButton) {
      browseNotesButton.addEventListener('click', openNoteBrowser);
    }

    if (closeBrowserButton) {
      closeBrowserButton.addEventListener('click', closeNoteBrowser);
    }

    if (prevNoteNav) {
      prevNoteNav.addEventListener('click', () => navigateNote(-1));
    }

    if (nextNoteNav) {
      nextNoteNav.addEventListener('click', () => navigateNote(1));
    }

    // Wire the toolbar arrow buttons to the same navigation handlers
    if (prevNoteToolbar) {
      prevNoteToolbar.addEventListener('click', () => navigateNote(-1));
    }

    if (nextNoteToolbar) {
      nextNoteToolbar.addEventListener('click', () => navigateNote(1));
    }

    if (addNewNoteButton) {
      addNewNoteButton.addEventListener('click', addNewNote);
    }

    // Wire bookmark button
    const bookmarkButton = document.getElementById('bookmark-note');
    if (bookmarkButton) {
      bookmarkButton.addEventListener('click', toggleBookmark);
    }

    // Wire bookmark filter in browse notes modal
    const bookmarkFilter = document.getElementById('bookmark-filter-select');
    if (bookmarkFilter) {
      bookmarkFilter.addEventListener('change', () => {
        renderNotesList();
      });
    }

    // Also wire the modal's add new note button
    const addNewNoteModalBtn = document.getElementById('add-new-note-modal');
    if (addNewNoteModalBtn) {
      addNewNoteModalBtn.addEventListener('click', addNewNote);
    }

    // Wire browser selection buttons
    const browserSelectAllBtn = document.getElementById('browser-select-all');
    if (browserSelectAllBtn) {
      browserSelectAllBtn.addEventListener('click', browserSelectAll);
    }

    const browserDeselectAllBtn = document.getElementById('browser-deselect-all');
    if (browserDeselectAllBtn) {
      browserDeselectAllBtn.addEventListener('click', browserDeselectAll);
    }

    // Wire delete selected notes button (footer only)
    const deleteSelectedFooterBtn = document.getElementById('delete-selected-notes-footer');
    if (deleteSelectedFooterBtn) {
      deleteSelectedFooterBtn.addEventListener('click', deleteSelectedNotes);
    }

    // Wire bulk bookmark action buttons
    const bookmarkSelectedBtn = document.getElementById('browser-bookmark-selected');
    if (bookmarkSelectedBtn) {
      bookmarkSelectedBtn.addEventListener('click', () => bulkSetBookmarks(true));
    }
    const unbookmarkSelectedBtn = document.getElementById('browser-unbookmark-selected');
    if (unbookmarkSelectedBtn) {
      unbookmarkSelectedBtn.addEventListener('click', () => bulkSetBookmarks(false));
    }

    // Close modal when clicking outside
    if (noteBrowserModal) {
      noteBrowserModal.addEventListener('click', (e) => {
        if (e.target === noteBrowserModal) {
          closeNoteBrowser();
        }
      });
    }

    // Add no-workspace action listeners
    const openWorkspaceBtn = document.getElementById('open-workspace-btn');
    const selectLocationBtn = document.getElementById('select-location-btn');

    if (openWorkspaceBtn) {
      openWorkspaceBtn.addEventListener('click', handleOpenWorkspace);
    }

    if (selectLocationBtn) {
      selectLocationBtn.addEventListener('click', handleSelectLocation);
    }

    // Add import modal event listeners
    const closeImportBtn = document.getElementById('close-import');
    const cancelImportBtn = document.getElementById('cancel-import');
    const selectAllBtn = document.getElementById('select-all-notes');
    const deselectAllBtn = document.getElementById('deselect-all-notes');
    const importSelectedBtn = document.getElementById('import-selected-notes');
    const finishImportBtn = document.getElementById('finish-import-btn');
    const importModal = document.getElementById('import-notes-modal');

    if (closeImportBtn) {
      closeImportBtn.addEventListener('click', closeImportModal);
    }

    if (cancelImportBtn) {
      cancelImportBtn.addEventListener('click', closeImportModal);
    }

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', selectAllNotes);
    }

    if (deselectAllBtn) {
      deselectAllBtn.addEventListener('click', deselectAllNotes);
    }

    if (importSelectedBtn) {
      importSelectedBtn.addEventListener('click', importSelectedNotes);
    }

    if (finishImportBtn) {
      finishImportBtn.addEventListener('click', closeImportModal);
    }

    // Close modal when clicking outside
    if (importModal) {
      importModal.addEventListener('click', (e) => {
        if (e.target === importModal) {
          closeImportModal();
        }
      });
    }

    // Load initial data from file storage
    loadInitialData();
  };

  // Run initialization
  initialize();
})();
