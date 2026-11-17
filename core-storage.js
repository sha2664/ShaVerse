/* ==========================================================================
   ShaVerse Core Storage, Undo/Redo, Brand Vault & Google Drive Engine
   ========================================================================== */

window.ShaVerse = window.ShaVerse || {};

(function (SV) {
  const DB_NAME = 'ShaVerseStudioDB';
  const DB_VERSION = 1;
  let db = null;

  // Global Application State
  SV.state = {
    projectId: 'sv_' + Date.now(),
    title: 'Untitled Masterpiece',
    mode: 'studio', // 'studio' | 'pixel' | 'timeline'
    canvas: {
      width: 1080,
      height: 1920,
      bg: '#111827',
      transparent: false,
      fps: 60,
      showGuides: true
    },
    layers: [],
    selectedLayerId: null,
    activeTool: 'select',
    currentTime: 0,
    duration: 15,
    isPlaying: false,
    beats: [],
    brandKit: {
      colors: ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ffffff', '#09090b'],
      fonts: ['Inter', 'Montserrat', 'Noto Sans Tamil', 'Playfair Display', 'Bebas Neue']
    }
  };

  // History Stacks
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 40;

  // Toast Helper
  SV.toast = function (msg, duration = 2600) {
    const el = document.getElementById('sv-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), duration);
  };

  // Initialize IndexedDB
  SV.initDB = function () {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('projects')) {
          database.createObjectStore('projects', { keyPath: 'projectId' });
        }
        if (!database.objectStoreNames.contains('assets')) {
          database.createObjectStore('assets', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('brand')) {
          database.createObjectStore('brand', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  };

  // Save/Get Binary Asset Blobs (Images, Videos, Audio, Fonts, LUTs)
  SV.saveAssetBlob = async function (id, blob, meta = {}) {
    if (!db) await SV.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put({ id, blob, meta, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(id);
      tx.onerror = (e) => reject(e.target.error);
    });
  };

  SV.getAssetBlob = async function (id) {
    if (!db) await SV.initDB();
    return new Promise((resolve) => {
      const tx = db.transaction('assets', 'readonly');
      const req = tx.objectStore('assets').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  };

  // Serialize Project State (excluding live DOM elements)
  SV.serializeProject = function () {
    const cleanLayers = SV.state.layers.map((l) => {
      const copy = { ...l };
      delete copy._imgEl;
      delete copy._videoEl;
      delete copy._audioBuf;
      delete copy._maskCanvas;
      if (l._maskCanvas) {
        copy.maskDataUrl = l._maskCanvas.toDataURL('image/png');
      }
      return copy;
    });

    const mainCanvas = document.getElementById('main-canvas');
    let thumb = '';
    try {
      const tmp = document.createElement('canvas');
      tmp.width = 240;
      tmp.height = Math.round((240 * SV.state.canvas.height) / SV.state.canvas.width);
      tmp.getContext('2d').drawImage(mainCanvas, 0, 0, tmp.width, tmp.height);
      thumb = tmp.toDataURL('image/jpeg', 0.7);
    } catch (e) {}

    return {
      projectId: SV.state.projectId,
      title: SV.state.title,
      mode: SV.state.mode,
      canvas: { ...SV.state.canvas },
      layers: cleanLayers,
      duration: SV.state.duration,
      beats: [...SV.state.beats],
      thumbnail: thumb,
      updatedAt: Date.now()
    };
  };

  // Auto-Save to IndexedDB
  let saveDebounce = null;
  SV.autoSave = function (pushUndo = true) {
    const badge = document.getElementById('save-status');
    if (badge) {
      badge.textContent = '● Saving...';
      badge.style.color = '#f59e0b';
    }

    if (pushUndo) {
      const snapshot = JSON.stringify(
        SV.state.layers.map((l) => {
          const c = { ...l };
          delete c._imgEl;
          delete c._videoEl;
          delete c._audioBuf;
          delete c._maskCanvas;
          if (l._maskCanvas) c.maskDataUrl = l._maskCanvas.toDataURL('image/png');
          return c;
        })
      );
      if (undoStack[undoStack.length - 1] !== snapshot) {
        undoStack.push(snapshot);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack.length = 0;
      }
    }

    clearTimeout(saveDebounce);
    saveDebounce = setTimeout(async () => {
      try {
        if (!db) await SV.initDB();
        const data = SV.serializeProject();
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(data);
        tx.oncomplete = () => {
          if (badge) {
            badge.textContent = '● Saved Locally';
            badge.style.color = '#10b981';
          }
        };
      } catch (err) {
        console.error('AutoSave error:', err);
      }
    }, 350);
  };

  // Undo & Redo
  SV.undo = async function () {
    if (undoStack.length <= 1) {
      SV.toast('Nothing to Undo');
      return;
    }
    const current = undoStack.pop();
    redoStack.push(current);
    const prev = JSON.parse(undoStack[undoStack.length - 1]);
    await SV.hydrateLayers(prev);
    SV.renderAll();
    SV.refreshUI();
    SV.toast('↩️ Undo');
  };

  SV.redo = async function () {
    if (redoStack.length === 0) {
      SV.toast('Nothing to Redo');
      return;
    }
    const nextStr = redoStack.pop();
    undoStack.push(nextStr);
    await SV.hydrateLayers(JSON.parse(nextStr));
    SV.renderAll();
    SV.refreshUI();
    SV.toast('↪️ Redo');
  };

  // Re-attach Media Elements & Masks after Undo/Load
  SV.hydrateLayers = async function (rawLayers) {
    const hydrated = [];
    for (const l of rawLayers) {
      const layer = { ...l };
      if (layer.assetId) {
        const record = await SV.getAssetBlob(layer.assetId);
        if (record && record.blob) {
          const url = URL.createObjectURL(record.blob);
          if (layer.type === 'image') {
            layer._imgEl = await SV.loadImageElement(url);
          } else if (layer.type === 'video') {
            layer._videoEl = await SV.loadVideoElement(url);
          } else if (layer.type === 'audio') {
            layer._audioUrl = url;
          }
        }
      }
      if (layer.maskDataUrl) {
        const mImg = await SV.loadImageElement(layer.maskDataUrl);
        const mc = document.createElement('canvas');
        mc.width = layer.width || 500;
        mc.height = layer.height || 500;
        mc.getContext('2d').drawImage(mImg, 0, 0, mc.width, mc.height);
        layer._maskCanvas = mc;
      }
      hydrated.push(layer);
    }
    SV.state.layers = hydrated;
  };

  SV.loadImageElement = (src) =>
    new Promise((res) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });

  SV.loadVideoElement = (src) =>
    new Promise((res) => {
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.src = src;
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'auto';
      vid.onloadeddata = () => res(vid);
      vid.onerror = () => res(null);
    });

  // Load All Saved Projects
  SV.listProjects = async function () {
    if (!db) await SV.initDB();
    return new Promise((resolve) => {
      const tx = db.transaction('projects', 'readonly');
      const req = tx.objectStore('projects').getAll();
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  };

  SV.loadProjectData = async function (proj) {
    SV.state.projectId = proj.projectId;
    SV.state.title = proj.title || 'Untitled';
    SV.state.mode = proj.mode || 'studio';
    SV.state.canvas = { ...SV.state.canvas, ...proj.canvas };
    SV.state.duration = proj.duration || 15;
    SV.state.beats = proj.beats || [];
    document.getElementById('project-title').value = SV.state.title;
    await SV.hydrateLayers(proj.layers || []);
    SV.state.selectedLayerId = SV.state.layers[0]?.id || null;
    undoStack.length = 0;
    redoStack.length = 0;
    SV.autoSave(true);
    SV.applyCanvasDimensions();
    SV.setMode(SV.state.mode);
    SV.renderAll();
    SV.refreshUI();
  };

  // Custom Font Installer (.ttf / .otf / .woff2)
  SV.installCustomFont = async function (file) {
    const fontName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const buf = await file.arrayBuffer();
    const fontFace = new FontFace(fontName, buf);
    await fontFace.load();
    document.fonts.add(fontFace);
    await SV.saveAssetBlob('font_' + fontName, new Blob([buf]), { fontName });
    if (!SV.state.brandKit.fonts.includes(fontName)) {
      SV.state.brandKit.fonts.unshift(fontName);
    }
    SV.saveBrandKit();
    SV.toast(`🔤 Font "${fontName}" installed!`);
    return fontName;
  };

  SV.saveBrandKit = async function () {
    if (!db) await SV.initDB();
    const tx = db.transaction('brand', 'readwrite');
    tx.objectStore('brand').put({ key: 'default', data: SV.state.brandKit });
  };

  SV.loadBrandKit = async function () {
    if (!db) await SV.initDB();
    return new Promise((resolve) => {
      const tx = db.transaction('brand', 'readonly');
      const req = tx.objectStore('brand').get('default');
      req.onsuccess = async () => {
        if (req.result && req.result.data) {
          SV.state.brandKit = req.result.data;
        }
        // Re-load saved custom fonts from IndexedDB
        const assetTx = db.transaction('assets', 'readonly');
        const allReq = assetTx.objectStore('assets').getAll();
        allReq.onsuccess = async () => {
          for (const item of allReq.result || []) {
            if (item.id.startsWith('font_') && item.meta?.fontName) {
              try {
                const buf = await item.blob.arrayBuffer();
                const ff = new FontFace(item.meta.fontName, buf);
                await ff.load();
                document.fonts.add(ff);
              } catch (e) {}
            }
          }
          resolve();
        };
      };
      req.onerror = () => resolve();
    });
  };

  // ========================================================================
  // GOOGLE DRIVE REST API v3 SYNC ENGINE
  // ========================================================================
  let driveAccessToken = null;
  let driveFolderId = null;

  SV.connectGoogleDrive = function () {
    const clientIdInput = document.getElementById('drive-client-id');
    const clientId = (clientIdInput?.value || localStorage.getItem('sv_drive_client_id') || '').trim();
    if (!clientId) {
      SV.toast('⚠️ Please paste your Google OAuth Client ID first');
      return;
    }
    localStorage.setItem('sv_drive_client_id', clientId);

    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      SV.toast('⚠️ Google Identity script still loading. Try again in 2s.');
      return;
    }

    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: async (resp) => {
        if (resp.error) {
          document.getElementById('drive-status-log').textContent = 'Auth Error: ' + resp.error;
          return;
        }
        driveAccessToken = resp.access_token;
        document.getElementById('drive-status-log').textContent = '✅ Connected! Locating /ShaVerse/ folder...';
        await ensureShaVerseFolder();
        document.getElementById('drive-status-log').textContent = '✅ Ready! Folder ID: ' + driveFolderId;
        SV.toast('☁️ Google Drive Connected!');
      }
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  };

  async function ensureShaVerseFolder() {
    if (!driveAccessToken) return null;
    const q = encodeURIComponent("name='ShaVerse' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: 'Bearer ' + driveAccessToken }
    });
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      driveFolderId = data.files[0].id;
      return driveFolderId;
    }
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + driveAccessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'ShaVerse',
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const created = await createRes.json();
    driveFolderId = created.id;
    return driveFolderId;
  }

  SV.backupToDrive = async function (customBlob = null, customFileName = null) {
    if (!driveAccessToken) {
      SV.connectGoogleDrive();
      return;
    }
    const folderId = await ensureShaVerseFolder();
    const logEl = document.getElementById('drive-status-log');
    if (logEl) logEl.textContent = '⬆️ Uploading to Google Drive...';
    SV.toast('⬆️ Syncing to Google Drive...');

    let fileBlob = customBlob;
    let fileName = customFileName;

    if (!fileBlob) {
      const proj = SV.serializeProject();
      fileName = `${proj.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.shaverse.json`;
      fileBlob = new Blob([JSON.stringify(proj)], { type: 'application/json' });
    }

    const metadata = { name: fileName, parents: [folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileBlob);

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + driveAccessToken },
      body: form
    });
    const result = await uploadRes.json();
    if (result.id) {
      if (logEl) logEl.textContent = `✅ Backed up "${fileName}" to /ShaVerse/`;
      SV.toast('☁️ Saved to Google Drive!');
    } else {
      if (logEl) logEl.textContent = '❌ Upload failed: ' + JSON.stringify(result);
    }
  };

  SV.pullFromDrive = async function () {
    if (!driveAccessToken) {
      SV.connectGoogleDrive();
      return;
    }
    const folderId = await ensureShaVerseFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and name contains '.shaverse.json' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`, {
      headers: { Authorization: 'Bearer ' + driveAccessToken }
    });
    const data = await res.json();
    if (!data.files || data.files.length === 0) {
      SV.toast('No .shaverse projects found in Drive');
      return;
    }
    const latest = data.files[0];
    const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${latest.id}?alt=media`, {
      headers: { Authorization: 'Bearer ' + driveAccessToken }
    });
    const projJson = await fileRes.json();
    await SV.loadProjectData(projJson);
    document.getElementById('modal-projects').classList.add('hidden');
    SV.toast(`☁️ Loaded "${projJson.title}" from Drive!`);
  };

  // Register Service Worker for Offline PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})(window.ShaVerse);