/* ==========================================================================
   ShaVerse Color Grading (DaVinci/Lightroom), Video/Audio Timeline (CapCut/AE)
   & Master UI Controller
   ========================================================================== */

(function (SV) {
  // ========================================================================
  // 1. REAL-TIME PIXEL COLOR GRADING, .CUBE LUT & CHROMA KEY PIPELINE
  // ========================================================================
  SV.applyColorPipeline = function (c, w, h, g) {
    if (!g) return;

    if (g.blur > 0) {
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext('2d');
      tctx.filter = `blur(${g.blur}px)`;
      tctx.drawImage(c.canvas, 0, 0);
      c.clearRect(0, 0, w, h);
      c.drawImage(tmp, 0, 0);
    }

    const imgData = c.getImageData(0, 0, w, h);
    const d = imgData.data;

    const expMul = Math.pow(2, g.exposure / 50);
    const conFactor = (259 * (g.contrast + 255)) / (255 * (259 - g.contrast));
    const satMul = 1 + g.saturation / 100;
    const tempShift = g.temperature * 0.6;
    const tintShift = g.tint * 0.6;

    // Chroma Key target RGB
    let ckR = 0, ckG = 255, ckB = 0;
    if (g.chromaKey && g.chromaKey.enabled) {
      const hex = g.chromaKey.color.replace('#', '');
      ckR = parseInt(hex.substring(0, 2), 16) || 0;
      ckG = parseInt(hex.substring(2, 4), 16) || 255;
      ckB = parseInt(hex.substring(4, 6), 16) || 0;
    }

    // Curve Midpoint Gamma Approximation
    const midPt = g.curves?.rgb?.[1]?.[1] ?? 128;
    const curveGamma = midPt === 128 ? 1 : Math.log(0.5) / Math.log(Math.max(1, midPt) / 255);

    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let r = d[i];
      let gr = d[i + 1];
      let b = d[i + 2];

      // Chroma Key Removal
      if (g.chromaKey && g.chromaKey.enabled) {
        const dist = Math.hypot(r - ckR, gr - ckG, b - ckB);
        const tol = g.chromaKey.tolerance || 60;
        const fea = g.chromaKey.feather || 10;
        if (dist < tol) {
          d[i + 3] = 0;
          continue;
        } else if (dist < tol + fea) {
          d[i + 3] = Math.round(d[i + 3] * ((dist - tol) / fea));
        }
      }

      // Exposure & Temperature/Tint
      r = r * expMul + tempShift + tintShift * 0.3;
      gr = gr * expMul - tintShift * 0.5;
      b = b * expMul - tempShift + tintShift * 0.3;

      // DaVinci Lift / Gamma / Gain Color Wheels
      const luma = (0.299 * r + 0.587 * gr + 0.114 * b) / 255;
      const shadowW = Math.pow(1 - luma, 2);
      const midW = 4 * luma * (1 - luma);
      const highW = Math.pow(luma, 2);

      r += g.lift.r * shadowW * 80 + g.gamma.r * midW * 80 + g.gain.r * highW * 80;
      gr += g.lift.g * shadowW * 80 + g.gamma.g * midW * 80 + g.gain.g * highW * 80;
      b += g.lift.b * shadowW * 80 + g.gamma.b * midW * 80 + g.gain.b * highW * 80;

      // Highlights & Shadows Sliders
      const hsDelta = g.highlights * highW * 0.8 + g.shadows * shadowW * 0.8;
      r += hsDelta;
      gr += hsDelta;
      b += hsDelta;

      // Contrast
      r = conFactor * (r - 128) + 128;
      gr = conFactor * (gr - 128) + 128;
      b = conFactor * (b - 128) + 128;

      // RGB Tone Curve
      if (curveGamma !== 1) {
        r = 255 * Math.pow(clamp(r) / 255, curveGamma);
        gr = 255 * Math.pow(clamp(gr) / 255, curveGamma);
        b = 255 * Math.pow(clamp(b) / 255, curveGamma);
      }

      // Saturation
      const gray = 0.299 * r + 0.587 * gr + 0.114 * b;
      r = gray + (r - gray) * satMul;
      gr = gray + (gr - gray) * satMul;
      b = gray + (b - gray) * satMul;

      // 3D .CUBE LUT Lookup (Trilinear / Nearest Grid)
      if (g.lutData && g.lutData.size > 1) {
        const lut = g.lutData;
        const sz = lut.size;
        const ri = Math.min(sz - 1, Math.max(0, Math.round((clamp(r) / 255) * (sz - 1))));
        const gi = Math.min(sz - 1, Math.max(0, Math.round((clamp(gr) / 255) * (sz - 1))));
        const bi = Math.min(sz - 1, Math.max(0, Math.round((clamp(b) / 255) * (sz - 1))));
        const idx = (bi * sz * sz + gi * sz + ri) * 3;
        const mix = g.lutIntensity ?? 1;
        r = r * (1 - mix) + lut.table[idx] * 255 * mix;
        gr = gr * (1 - mix) + lut.table[idx + 1] * 255 * mix;
        b = b * (1 - mix) + lut.table[idx + 2] * 255 * mix;
      }

      d[i] = clamp(r);
      d[i + 1] = clamp(gr);
      d[i + 2] = clamp(b);
    }

    c.putImageData(imgData, 0, 0);

    // Vignette Overlay
    if (g.vignette > 0) {
      const grad = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, g.vignette / 100)})`);
      c.fillStyle = grad;
      c.fillRect(0, 0, w, h);
    }
  };

  // Parse .CUBE 3D LUT File
  SV.parseCubeLUT = function (text, name = 'Custom LUT') {
    const lines = text.split(/\r?\n/);
    let size = 0;
    const vals = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('TITLE') || line.startsWith('DOMAIN_')) continue;
      if (line.startsWith('LUT_3D_SIZE')) {
        size = parseInt(line.split(/\s+/)[1], 10);
        continue;
      }
      const parts = line.split(/\s+/).map(Number);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        vals.push(parts[0], parts[1], parts[2]);
      }
    }
    if (size > 1 && vals.length >= size * size * size * 3) {
      return { name, size, table: new Float32Array(vals) };
    }
    return null;
  };

  // Live RGB Histogram Scopes (DaVinci Style)
  SV.updateScopes = function () {
    const box = document.getElementById('scopes-overlay');
    if (!box || box.classList.contains('hidden')) return;
    const sc = document.getElementById('scopes-canvas');
    const mc = document.getElementById('main-canvas');
    if (!sc || !mc) return;

    const sctx = sc.getContext('2d');
    const sample = document.createElement('canvas');
    sample.width = 160;
    sample.height = 90;
    sample.getContext('2d').drawImage(mc, 0, 0, 160, 90);
    const data = sample.getContext('2d').getImageData(0, 0, 160, 90).data;

    const histR = new Uint32Array(256);
    const histG = new Uint32Array(256);
    const histB = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) {
      histR[data[i]]++;
      histG[data[i + 1]]++;
      histB[data[i + 2]]++;
    }

    sctx.fillStyle = '#09090b';
    sctx.fillRect(0, 0, sc.width, sc.height);
    const maxVal = Math.max(1, ...histR, ...histG, ...histB);
    sctx.globalCompositeOperation = 'screen';

    const drawChan = (arr, color) => {
      sctx.strokeStyle = color;
      sctx.lineWidth = 1.2;
      sctx.beginPath();
      for (let x = 0; x < 256; x++) {
        const px = (x / 255) * sc.width;
        const py = sc.height - (arr[x] / maxVal) * (sc.height - 6);
        if (x === 0) sctx.moveTo(px, py);
        else sctx.lineTo(px, py);
      }
      sctx.stroke();
    };
    drawChan(histR, '#ef4444');
    drawChan(histG, '#10b981');
    drawChan(histB, '#3b82f6');
    sctx.globalCompositeOperation = 'source-over';
  };

  // ========================================================================
  // 2. VIDEO PLAYBACK, TIMELINE, KEYFRAMES & AUTO BEAT-SYNC ENGINE
  // ========================================================================
  let rafId = null;
  let lastFrameTime = 0;
  const PX_PER_SEC = 48;

  SV.togglePlay = function () {
    SV.state.isPlaying = !SV.state.isPlaying;
    const btn = document.getElementById('btn-play-pause');
    if (btn) btn.textContent = SV.state.isPlaying ? '⏸️' : '▶️';

    if (SV.state.isPlaying) {
      lastFrameTime = performance.now();
      syncMediaElements(true);
      rafId = requestAnimationFrame(playbackLoop);
    } else {
      cancelAnimationFrame(rafId);
      syncMediaElements(false);
    }
  };

  function syncMediaElements(play) {
    for (const l of SV.state.layers) {
      if (l.type === 'video' && l._videoEl) {
        l._videoEl.playbackRate = l.speed || 1;
        const localT = Math.max(0, (SV.state.currentTime - l.startTime) * (l.speed || 1));
        if (Math.abs(l._videoEl.currentTime - localT) > 0.15) {
          try { l._videoEl.currentTime = localT; } catch (e) {}
        }
        if (play && SV.state.currentTime >= l.startTime && SV.state.currentTime <= l.startTime + l.duration) {
          l._videoEl.play().catch(() => {});
        } else {
          l._videoEl.pause();
        }
      }
    }
  }

  function playbackLoop(now) {
    if (!SV.state.isPlaying) return;
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    SV.state.currentTime += dt;

    if (SV.state.currentTime >= SV.state.duration) {
      SV.state.currentTime = 0;
      syncMediaElements(true);
    } else {
      // Ensure active videos are playing
      for (const l of SV.state.layers) {
        if (l.type === 'video' && l._videoEl) {
          const active = SV.state.currentTime >= l.startTime && SV.state.currentTime <= l.startTime + l.duration;
          if (active && l._videoEl.paused) l._videoEl.play().catch(() => {});
          if (!active && !l._videoEl.paused) l._videoEl.pause();
        }
      }
    }

    updateTimelinePlayheadUI();
    SV.renderAll();
    rafId = requestAnimationFrame(playbackLoop);
  }

  SV.seekTo = function (t) {
    SV.state.currentTime = Math.max(0, Math.min(SV.state.duration, t));
    for (const l of SV.state.layers) {
      if (l.type === 'video' && l._videoEl) {
        const localT = Math.max(0, (SV.state.currentTime - l.startTime) * (l.speed || 1));
        try { l._videoEl.currentTime = localT; } catch (e) {}
      }
    }
    updateTimelinePlayheadUI();
    SV.renderAll();
  };

  function updateTimelinePlayheadUI() {
    const tc = document.getElementById('timecode-display');
    const fmt = (sec) => {
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(Math.floor(sec % 60)).padStart(2, '0');
      const ms = String(Math.floor((sec % 1) * 100)).padStart(2, '0');
      return `${m}:${s}.${ms}`;
    };
    if (tc) tc.textContent = `${fmt(SV.state.currentTime)} / ${fmt(SV.state.duration)}`;

    const ph = document.getElementById('playhead');
    if (ph) ph.style.left = `${SV.state.currentTime * PX_PER_SEC + 6}px`;
  }

  // Split Selected Clip at Playhead (CapCut Style)
  SV.splitSelectedClip = function () {
    const sel = SV.getSelectedLayer();
    const t = SV.state.currentTime;
    if (!sel || t <= sel.startTime + 0.1 || t >= sel.startTime + sel.duration - 0.1) {
      SV.toast('⚠️ Move playhead inside a clip to split');
      return;
    }
    const firstDur = t - sel.startTime;
    const secondDur = sel.duration - firstDur;
    sel.duration = firstDur;

    const clone = JSON.parse(JSON.stringify({
      ...sel,
      _imgEl: undefined,
      _videoEl: undefined,
      _maskCanvas: undefined
    }));
    clone.id = 'lyr_' + Date.now();
    clone.name = sel.name + ' (Part 2)';
    clone.startTime = t;
    clone.duration = secondDur;
    clone._imgEl = sel._imgEl;
    clone._videoEl = sel._videoEl;
    clone._maskCanvas = sel._maskCanvas;

    SV.state.layers.unshift(clone);
    SV.state.selectedLayerId = clone.id;
    SV.autoSave(true);
    SV.refreshUI();
    SV.toast('✂️ Clip Split!');
  };

  // Add/Update Keyframe at Playhead (After Effects Style)
  SV.toggleKeyframeAtPlayhead = function () {
    const sel = SV.getSelectedLayer();
    if (!sel) {
      SV.toast('⚠️ Select a layer first');
      return;
    }
    const t = Number(SV.state.currentTime.toFixed(2));
    sel.keyframes = sel.keyframes || [];
    const existingIdx = sel.keyframes.findIndex((k) => Math.abs(k.time - t) < 0.08);
    if (existingIdx >= 0) {
      sel.keyframes.splice(existingIdx, 1);
      SV.toast('◇ Keyframe Removed');
    } else {
      sel.keyframes.push({
        time: t,
        x: sel.x,
        y: sel.y,
        scaleX: sel.scaleX,
        scaleY: sel.scaleY,
        rotation: sel.rotation,
        opacity: sel.opacity,
        ease: 'ease-in-out'
      });
      SV.toast(`◆ Keyframe Added at ${t}s (Smooth Ease)`);
    }
    SV.autoSave(true);
    SV.refreshUI();
  };

  // Auto Beat-Sync Detection using WebAudio API
  SV.detectAudioBeats = async function () {
    const audioLayer = SV.state.layers.find((l) => l.type === 'audio' && l.assetId);
    if (!audioLayer) {
      SV.toast('⚠️ Add an Audio track first via Media');
      return;
    }
    SV.toast('🎵 Analyzing audio waveform & bass peaks...');
    const rec = await SV.getAssetBlob(audioLayer.assetId);
    if (!rec || !rec.blob) return;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await audioCtx.decodeAudioData(await rec.blob.arrayBuffer());
    const channel = buf.getChannelData(0);
    const step = Math.floor(buf.sampleRate * 0.25); // 250ms windows
    const beats = [];

    for (let i = 0; i < channel.length; i += step) {
      let peak = 0;
      for (let j = 0; j < step && i + j < channel.length; j += 10) {
        const v = Math.abs(channel[i + j]);
        if (v > peak) peak = v;
      }
      if (peak > 0.62) {
        beats.push(Number((i / buf.sampleRate).toFixed(2)));
      }
    }
    SV.state.beats = beats;
    SV.autoSave(true);
    SV.refreshUI();
    SV.toast(`🎵 ${beats.length} Beat Markers Synced!`);
  };

  // Render Multi-Track Timeline UI
  function renderTimelineTracks() {
    const container = document.getElementById('tracks-container');
    if (!container) return;
    container.innerHTML = '';

    SV.state.layers.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'sv-track-row';
      row.style.width = `${Math.max(600, SV.state.duration * PX_PER_SEC + 80)}px`;

      const clip = document.createElement('div');
      clip.className = `sv-clip-block ${l.type === 'audio' ? 'audio-clip' : ''} ${l.id === SV.state.selectedLayerId ? 'selected' : ''}`;
      clip.style.left = `${l.startTime * PX_PER_SEC}px`;
      clip.style.width = `${Math.max(28, l.duration * PX_PER_SEC)}px`;
      clip.innerHTML = `<span>${l.name}</span><span>${l.keyframes?.length ? '◆' + l.keyframes.length : ''}</span>`;

      clip.addEventListener('click', () => {
        SV.state.selectedLayerId = l.id;
        SV.renderAll();
        SV.refreshUI();
      });

      // Drag clip along timeline
      let startX = 0, origStart = 0;
      clip.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        origStart = l.startTime;
        const onMove = (ev) => {
          const deltaSec = (ev.clientX - startX) / PX_PER_SEC;
          l.startTime = Math.max(0, Number((origStart + deltaSec).toFixed(2)));
          clip.style.left = `${l.startTime * PX_PER_SEC}px`;
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          SV.autoSave(true);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      row.appendChild(clip);

      // Render Beat Dots
      SV.state.beats.forEach((bTime) => {
        const dot = document.createElement('div');
        dot.className = 'sv-beat-dot';
        dot.style.left = `${bTime * PX_PER_SEC}px`;
        row.appendChild(dot);
      });

      container.appendChild(row);
    });
  }

  // ========================================================================
  // 3. PRO EXPORT, INSTAGRAM CAROUSEL SLICER & VIDEO COMPILER
  // ========================================================================
  SV.executeExport = async function (toDrive = false) {
    const format = document.getElementById('export-format').value;
    const scale = parseFloat(document.getElementById('export-scale').value) || 1;
    const quality = (parseInt(document.getElementById('export-quality').value, 10) || 95) / 100;
    const title = SV.state.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'ShaVerse_Export';

    // Temporarily hide selection overlay for clean render
    const prevSel = SV.state.selectedLayerId;
    const prevGuides = SV.state.canvas.showGuides;
    SV.state.selectedLayerId = null;
    SV.state.canvas.showGuides = false;
    SV.renderAll();

    const mc = document.getElementById('main-canvas');
    const outW = Math.round(mc.width * scale);
    const outH = Math.round(mc.height * scale);

    const downloadBlob = async (blob, filename) => {
      if (toDrive) {
        await SV.backupToDrive(blob, filename);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    };

    try {
      if (format === 'shaverse') {
        const proj = SV.serializeProject();
        const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
        await downloadBlob(blob, `${title}.shaverse.json`);
      } else if (format === 'carousel') {
        const slices = Math.max(2, Math.min(10, parseInt(document.getElementById('carousel-slices').value, 10) || 5));
        const sliceW = Math.floor(outW / slices);
        for (let s = 0; s < slices; s++) {
          const sc = document.createElement('canvas');
          sc.width = sliceW;
          sc.height = outH;
          sc.getContext('2d').drawImage(mc, s * (mc.width / slices), 0, mc.width / slices, mc.height, 0, 0, sliceW, outH);
          const blob = await new Promise((r) => sc.toBlob(r, 'image/png'));
          await downloadBlob(blob, `${title}_Slide_${s + 1}.png`);
        }
        SV.toast(`🎠 Exported ${slices} HD Carousel Slides!`);
      } else if (format === 'webm') {
        // Real-Time 60fps Video Render
        const progWrap = document.getElementById('export-progress-wrap');
        const progBar = document.getElementById('export-progress-bar');
        const progText = document.getElementById('export-progress-text');
        progWrap.classList.remove('hidden');

        const stream = mc.captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          await downloadBlob(blob, `${title}.webm`);
          progWrap.classList.add('hidden');
          SV.toast('🎬 Video Render Complete!');
        };

        SV.state.mode = 'timeline';
        SV.seekTo(0);
        recorder.start();
        SV.togglePlay();

        const checkInt = setInterval(() => {
          const pct = Math.min(100, Math.round((SV.state.currentTime / SV.state.duration) * 100));
          progBar.style.width = pct + '%';
          progText.textContent = `Rendering Video... ${pct}%`;
          if (SV.state.currentTime >= SV.state.duration - 0.08 || !SV.state.isPlaying) {
            clearInterval(checkInt);
            if (SV.state.isPlaying) SV.togglePlay();
            recorder.stop();
          }
        }, 120);
      } else {
        // PNG / JPG / WebP Image Export
        const mime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
        const outC = document.createElement('canvas');
        outC.width = outW;
        outC.height = outH;
        outC.getContext('2d').drawImage(mc, 0, 0, outW, outH);
        const blob = await new Promise((r) => outC.toBlob(r, mime, quality));
        await downloadBlob(blob, `${title}.${format}`);
        SV.toast(`✅ Exported ${title}.${format.toUpperCase()}`);
      }
    } finally {
      SV.state.selectedLayerId = prevSel;
      SV.state.canvas.showGuides = prevGuides;
      SV.renderAll();
    }
  };

  // ========================================================================
  // 4. CONTEXTUAL MOBILE DOCK, SLIDE-UP DRAWERS & DESKTOP INSPECTOR
  // ========================================================================
  const DOCK_TOOLS_BY_MODE = {
    studio: [
      { id: 'text', icon: '🔤', label: 'Text' },
      { id: 'media', icon: '🖼️', label: 'Add Media' },
      { id: 'shapes', icon: '🔷', label: 'Elements' },
      { id: 'transform', icon: '🎛️', label: 'Adjust' },
      { id: 'color', icon: '🎡', label: 'Color/LUT' },
      { id: 'cutout', icon: '✨', label: 'AI Cutout' },
      { id: 'brand', icon: '💼', label: 'Brand Kit' },
      { id: 'layers', icon: '📚', label: 'Layers' }
    ],
    pixel: [
      { id: 'select', icon: '↖️', label: 'Move' },
      { id: 'brush', icon: '🖌️', label: 'Brush/Mask' },
      { id: 'pen', icon: '✒️', label: 'Pen Tool' },
      { id: 'cutout', icon: '✨', label: 'AI Cutout' },
      { id: 'color', icon: '🎡', label: 'Grading' },
      { id: 'transform', icon: '🔀', label: 'Blend/Opacity' },
      { id: 'layers', icon: '📚', label: 'Layers' }
    ],
    timeline: [
      { id: 'media', icon: '➕', label: 'Add Clip' },
      { id: 'text', icon: '🔤', label: 'Caption' },
      { id: 'speed', icon: '⚡', label: 'Speed/Key' },
      { id: 'color', icon: '🎬', label: 'DaVinci' },
      { id: 'chroma', icon: '🟩', label: 'Chroma Key' },
      { id: 'audio', icon: '🎵', label: 'Beat/Audio' },
      { id: 'layers', icon: '📚', label: 'Tracks' }
    ]
  };

  SV.setMode = function (mode) {
    SV.state.mode = mode;
    document.getElementById('app').setAttribute('data-mode', mode);
    document.querySelectorAll('.sv-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.targetMode === mode);
    });
    SV.applyCanvasDimensions();
    SV.refreshUI();
  };

  SV.refreshUI = function () {
    const countEl = document.getElementById('layer-count');
    if (countEl) countEl.textContent = SV.state.layers.length;

    // Render Mobile Bottom Dock
    const dock = document.getElementById('mobile-bottom-dock');
    if (dock) {
      const items = DOCK_TOOLS_BY_MODE[SV.state.mode] || DOCK_TOOLS_BY_MODE.studio;
      dock.innerHTML = items
        .map((it) => `<button class="sv-dock-btn" data-dock-action="${it.id}">${it.icon}<span>${it.label}</span></button>`)
        .join('');
      dock.querySelectorAll('.sv-dock-btn').forEach((btn) => {
        btn.addEventListener('click', () => handleToolTrigger(btn.dataset.dockAction));
      });
    }

    // Update Desktop Right Panel if visible
    const deskInsp = document.getElementById('desktop-inspector-content');
    const deskLayers = document.getElementById('desktop-layers-content');
    if (deskInsp) deskInsp.innerHTML = buildInspectorHTML(SV.state.activeTool);
    if (deskLayers) deskLayers.innerHTML = buildLayersHTML();
    bindInspectorEvents(document);

    if (SV.state.mode === 'timeline') renderTimelineTracks();
  };

  function handleToolTrigger(action) {
    if (action === 'media') {
      document.getElementById('input-media').click();
      return;
    }
    if (action === 'cutout') {
      SV.removeBackgroundSmart();
      return;
    }
    if (action === 'text') {
      const sel = SV.getSelectedLayer();
      if (!sel || sel.type !== 'text') {
        SV.createLayer({ type: 'text', name: 'Text Layer', text: 'ShaVerse Pro', width: 700, height: 180 });
      }
    }

    SV.state.activeTool = action;
    document.querySelectorAll('.sv-rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === action));

    // Open Mobile Contextual Drawer
    const drawer = document.getElementById('contextual-drawer');
    const titleEl = document.getElementById('drawer-title');
    const bodyEl = document.getElementById('drawer-body');
    if (drawer && bodyEl) {
      titleEl.textContent = action.toUpperCase() + ' STUDIO';
      bodyEl.innerHTML = action === 'layers' ? buildLayersHTML() : buildInspectorHTML(action);
      drawer.classList.remove('hidden');
      bindInspectorEvents(bodyEl);
    }

    const deskInsp = document.getElementById('desktop-inspector-content');
    if (deskInsp) {
      deskInsp.innerHTML = buildInspectorHTML(action);
      bindInspectorEvents(deskInsp);
    }
    SV.renderAll();
  }

  // Dynamic Contextual Inspector HTML Generator
  function buildInspectorHTML(tool) {
    const sel = SV.getSelectedLayer();

    if (tool === 'shapes') {
      return `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">Add Vector Elements</div>
          <div class="sv-grid-btns">
            <button class="sv-chip-btn" data-add-shape="rect">⬛ Box</button>
            <button class="sv-chip-btn" data-add-shape="circle">🟣 Circle</button>
            <button class="sv-chip-btn" data-add-shape="star">⭐ Star</button>
            <button class="sv-chip-btn" data-add-shape="triangle">🔺 Triangle</button>
          </div>
        </div>
        ${sel && sel.type === 'shape' ? `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">Shape Style</div>
          <div class="sv-slider-row"><label>Fill Color</label><input type="color" data-prop="fillColor" value="${sel.fillColor}" /></div>
          <div class="sv-slider-row"><label>Corner Radius</label><input type="range" min="0" max="250" data-prop="cornerRadius" value="${sel.cornerRadius}" /><span>${sel.cornerRadius}</span></div>
          <div class="sv-slider-row"><label>Stroke Width</label><input type="range" min="0" max="40" data-prop="strokeWidth" value="${sel.strokeWidth}" /><span>${sel.strokeWidth}</span></div>
        </div>` : ''}
      `;
    }

    if (tool === 'pen') {
      return `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">Illustrator Bezier Pen Tool</div>
          <p style="color:var(--text-muted);font-size:11px;">Tap anywhere on the canvas to plot vector anchor points (${SV.penState.points.length} points placed).</p>
          <div class="sv-btn-group">
            <button class="sv-primary-btn" id="btn-pen-close">✓ Close & Fill Shape</button>
            <button class="sv-secondary-btn" id="btn-pen-open">〰️ Open Stroke</button>
            <button class="sv-secondary-btn" id="btn-pen-clear">🗑️ Clear</button>
          </div>
        </div>
      `;
    }

    if (tool === 'brush' || tool === 'retouch') {
      return `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">Photoshop Brush & Non-Destructive Mask</div>
          <div class="sv-grid-btns">
            <button class="sv-chip-btn ${SV.brush.mode === 'paint' ? 'active' : ''}" data-bmode="paint">🖌️ Paint</button>
            <button class="sv-chip-btn ${SV.brush.mode === 'erase' ? 'active' : ''}" data-bmode="erase">🧽 Erase</button>
            <button class="sv-chip-btn ${SV.brush.mode === 'mask-hide' ? 'active' : ''}" data-bmode="mask-hide">🎭 Mask Hide</button>
            <button class="sv-chip-btn ${SV.brush.mode === 'mask-reveal' ? 'active' : ''}" data-bmode="mask-reveal">👁️ Mask Show</button>
            <button class="sv-chip-btn ${SV.brush.mode === 'dodge' ? 'active' : ''}" data-bmode="dodge">☀️ Dodge</button>
            <button class="sv-chip-btn ${SV.brush.mode === 'burn' ? 'active' : ''}" data-bmode="burn">🌑 Burn</button>
          </div>
          <div class="sv-slider-row"><label>Brush Size</label><input type="range" min="4" max="180" id="brush-size" value="${SV.brush.size}" /><span>${SV.brush.size}px</span></div>
          <div class="sv-slider-row"><label>Brush Color</label><input type="color" id="brush-color" value="${SV.brush.color}" /></div>
        </div>
      `;
    }

    if (tool === 'brand') {
      return `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">Brand Kit Palette & Custom Fonts</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${SV.state.brandKit.colors.map((c) => `<button class="sv-chip-btn" style="background:${c};width:34px;height:34px;" data-brand-color="${c}"></button>`).join('')}
          </div>
          <button class="sv-primary-btn" onclick="document.getElementById('input-font').click()">➕ Upload Custom Font (.TTF / .OTF)</button>
        </div>
      `;
    }

    if (!sel) {
      return `<div class="sv-ctrl-group"><p style="color:var(--text-muted);">Tap any layer on the canvas or add Text / Media to inspect pro controls.</p></div>`;
    }

    if (tool === 'text' && sel.type === 'text') {
      return `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">Typography & Tamil/English Engine</div>
          <input type="text" data-prop="text" value="${sel.text.replace(/"/g, '&quot;')}" style="width:100%;padding:8px;border-radius:8px;background:var(--bg-panel);color:#fff;border:1px solid var(--border);" />
          <div class="sv-form-row">
            <select data-prop="fontFamily">
              ${SV.state.brandKit.fonts.map((f) => `<option value="${f}" ${sel.fontFamily === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <select data-prop="textStyle">
              <option value="none" ${sel.textStyle === 'none' ? 'selected' : ''}>Clean Flat</option>
              <option value="neon" ${sel.textStyle === 'neon' ? 'selected' : ''}>✨ Neon Glow</option>
              <option value="3d" ${sel.textStyle === '3d' ? 'selected' : ''}>🧊 3D Extrude</option>
              <option value="outline" ${sel.textStyle === 'outline' ? 'selected' : ''}>⭕ Hollow Outline</option>
              <option value="shadow" ${sel.textStyle === 'shadow' ? 'selected' : ''}>🌑 Drop Shadow</option>
            </select>
          </div>
          <div class="sv-slider-row"><label>Font Size</label><input type="range" min="16" max="320" data-prop="fontSize" value="${sel.fontSize}" /><span>${sel.fontSize}</span></div>
          <div class="sv-slider-row"><label>Arc Curve</label><input type="range" min="-100" max="100" data-prop="textCurve" value="${sel.textCurve}" /><span>${sel.textCurve}°</span></div>
          <div class="sv-slider-row"><label>Text Color</label><input type="color" data-prop="textColor" value="${sel.textColor}" />
            <label style="min-width:auto;"><input type="checkbox" data-prop="textGradient" ${sel.textGradient ? 'checked' : ''} /> Gradient</label>
          </div>
          <button class="sv-secondary-btn" onclick="document.getElementById('input-font').click()">🔤 Install .TTF / .OTF Font</button>
        </div>
      `;
    }

    if (tool === 'color') {
      const g = sel.grade;
      return `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">DaVinci Color Wheels & Lightroom Tone</div>
          <div class="sv-slider-row"><label>Exposure</label><input type="range" min="-100" max="100" data-grade="exposure" value="${g.exposure}" /><span>${g.exposure}</span></div>
          <div class="sv-slider-row"><label>Contrast</label><input type="range" min="-100" max="100" data-grade="contrast" value="${g.contrast}" /><span>${g.contrast}</span></div>
          <div class="sv-slider-row"><label>Saturation</label><input type="range" min="-100" max="100" data-grade="saturation" value="${g.saturation}" /><span>${g.saturation}</span></div>
          <div class="sv-slider-row"><label>Temp (Warm)</label><input type="range" min="-100" max="100" data-grade="temperature" value="${g.temperature}" /><span>${g.temperature}</span></div>
          <div class="sv-slider-row"><label>Highlights</label><input type="range" min="-100" max="100" data-grade="highlights" value="${g.highlights}" /><span>${g.highlights}</span></div>
          <div class="sv-slider-row"><label>Shadows</label><input type="range" min="-100" max="100" data-grade="shadows" value="${g.shadows}" /><span>${g.shadows}</span></div>
          <div class="sv-slider-row"><label>Midtone Curve</label><input type="range" min="30" max="225" id="curve-mid-slider" value="${g.curves.rgb[1][1]}" /><span>${g.curves.rgb[1][1]}</span></div>
          <div class="sv-slider-row"><label>Lift Red (Shad)</label><input type="range" min="-1" max="1" step="0.05" data-wheel="lift.r" value="${g.lift.r}" /><span>${g.lift.r}</span></div>
          <div class="sv-slider-row"><label>Gain Blue (High)</label><input type="range" min="-1" max="1" step="0.05" data-wheel="gain.b" value="${g.gain.b}" /><span>${g.gain.b}</span></div>
          <div class="sv-slider-row"><label>Vignette</label><input type="range" min="0" max="100" data-grade="vignette" value="${g.vignette}" /><span>${g.vignette}%</span></div>
          <div class="sv-slider-row"><label>Gaussian Blur</label><input type="range" min="0" max="40" data-grade="blur" value="${g.blur}" /><span>${g.blur}px</span></div>
          <button class="sv-primary-btn" onclick="document.getElementById('input-lut').click()">🎞️ Load .CUBE 3D LUT ${g.lutName ? '(' + g.lutName + ')' : ''}</button>
        </div>
      `;
    }

    if (tool === 'chroma') {
      const ck = sel.grade.chromaKey;
      return `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">CapCut / DaVinci Chroma Key (Green Screen)</div>
          <label class="sv-checkbox-line"><input type="checkbox" id="ck-enabled" ${ck.enabled ? 'checked' : ''} /> Enable Chroma Key</label>
          <div class="sv-slider-row"><label>Key Color</label><input type="color" id="ck-color" value="${ck.color}" /></div>
          <div class="sv-slider-row"><label>Tolerance</label><input type="range" min="5" max="180" id="ck-tol" value="${ck.tolerance}" /><span>${ck.tolerance}</span></div>
          <div class="sv-slider-row"><label>Edge Feather</label><input type="range" min="0" max="60" id="ck-fea" value="${ck.feather}" /><span>${ck.feather}</span></div>
        </div>
      `;
    }

    if (tool === 'speed' || tool === 'audio') {
      return `
        <div class="sv-ctrl-group">
          <div class="sv-ctrl-title">Speed Ramping & Keyframe Timeline</div>
          <div class="sv-slider-row"><label>Clip Speed</label><input type="range" min="0.25" max="4" step="0.25" data-prop="speed" value="${sel.speed || 1}" /><span>${sel.speed || 1}x</span></div>
          <div class="sv-slider-row"><label>Duration (sec)</label><input type="range" min="0.5" max="60" step="0.5" data-prop="duration" value="${sel.duration}" /><span>${sel.duration}s</span></div>
          <div class="sv-btn-group">
            <button class="sv-primary-btn" onclick="ShaVerse.toggleKeyframeAtPlayhead()">◆ Add/Remove Keyframe</button>
            <button class="sv-secondary-btn" onclick="ShaVerse.detectAudioBeats()">🎵 Auto Beat-Sync</button>
          </div>
        </div>
      `;
    }

    // Default Transform & Blending Controls
    return `
      <div class="sv-ctrl-group">
        <div class="sv-ctrl-title">Transform, Opacity & 27 Blend Modes</div>
        <div class="sv-slider-row"><label>Opacity</label><input type="range" min="0" max="1" step="0.02" data-prop="opacity" value="${sel.opacity}" /><span>${Math.round(sel.opacity * 100)}%</span></div>
        <div class="sv-slider-row"><label>Scale</label><input type="range" min="0.1" max="4" step="0.05" data-prop="scaleX" value="${sel.scaleX}" /><span>${sel.scaleX}x</span></div>
        <div class="sv-slider-row"><label>Rotation</label><input type="range" min="-180" max="180" data-prop="rotation" value="${sel.rotation}" /><span>${sel.rotation}°</span></div>
        <div class="sv-slider-row">
          <label>Blend Mode</label>
          <select data-prop="blendMode">
            ${SV.BLEND_MODES.map((m) => `<option value="${m}" ${sel.blendMode === m ? 'selected' : ''}>${SV.BLEND_LABELS[m] || m}</option>`).join('')}
          </select>
        </div>
        <div class="sv-btn-group">
          <button class="sv-secondary-btn" id="btn-dup-layer">📄 Duplicate</button>
          <button class="sv-secondary-btn" id="btn-del-layer" style="color:#ef4444;">🗑️ Delete</button>
        </div>
      </div>
    `;
  }

  function buildLayersHTML() {
    if (SV.state.layers.length === 0) {
      return `<p style="color:var(--text-muted);">No layers yet. Add Text, Shapes, or Media.</p>`;
    }
    return SV.state.layers
      .map(
        (l, idx) => `
      <div class="sv-layer-item ${l.id === SV.state.selectedLayerId ? 'selected' : ''}">
        <button class="sv-mini-pill" data-layer-vis="${l.id}">${l.visible ? '👁️' : '🚫'}</button>
        <span class="sv-layer-name" data-layer-sel="${l.id}">${l.name}</span>
        <button class="sv-mini-pill" data-layer-up="${idx}">⬆️</button>
        <button class="sv-mini-pill" data-layer-down="${idx}">⬇️</button>
        <button class="sv-mini-pill" data-layer-lock="${l.id}">${l.locked ? '🔒' : '🔓'}</button>
      </div>`
      )
      .join('');
  }

  function bindInspectorEvents(root) {
    const sel = SV.getSelectedLayer();

    root.querySelectorAll('[data-prop]').forEach((el) => {
      const handler = () => {
        if (!sel) return;
        const prop = el.dataset.prop;
        if (el.type === 'checkbox') {
          sel[prop] = el.checked;
        } else if (el.type === 'range' || el.type === 'number') {
          const val = parseFloat(el.value);
          sel[prop] = val;
          if (prop === 'scaleX') sel.scaleY = val;
        } else {
          sel[prop] = el.value;
        }
        SV.renderAll();
        SV.autoSave(false);
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', () => SV.autoSave(true));
    });

    root.querySelectorAll('[data-grade]').forEach((el) => {
      el.addEventListener('input', () => {
        if (!sel) return;
        sel.grade[el.dataset.grade] = parseFloat(el.value);
        SV.renderAll();
      });
      el.addEventListener('change', () => SV.autoSave(true));
    });

    root.querySelectorAll('[data-wheel]').forEach((el) => {
      el.addEventListener('input', () => {
        if (!sel) return;
        const [wheel, chan] = el.dataset.wheel.split('.');
        sel.grade[wheel][chan] = parseFloat(el.value);
        SV.renderAll();
      });
    });

    const curveSlider = root.querySelector('#curve-mid-slider');
    if (curveSlider && sel) {
      curveSlider.addEventListener('input', () => {
        sel.grade.curves.rgb[1][1] = parseInt(curveSlider.value, 10);
        SV.renderAll();
      });
    }

    // Chroma Key bindings
    const ckEn = root.querySelector('#ck-enabled');
    if (ckEn && sel) {
      ckEn.addEventListener('change', () => { sel.grade.chromaKey.enabled = ckEn.checked; SV.renderAll(); });
      root.querySelector('#ck-color')?.addEventListener('input', (e) => { sel.grade.chromaKey.color = e.target.value; SV.renderAll(); });
      root.querySelector('#ck-tol')?.addEventListener('input', (e) => { sel.grade.chromaKey.tolerance = parseInt(e.target.value, 10); SV.renderAll(); });
      root.querySelector('#ck-fea')?.addEventListener('input', (e) => { sel.grade.chromaKey.feather = parseInt(e.target.value, 10); SV.renderAll(); });
    }

    // Add Shape buttons
    root.querySelectorAll('[data-add-shape]').forEach((btn) => {
      btn.addEventListener('click', () => {
        SV.createLayer({ type: 'shape', shapeType: btn.dataset.addShape, name: btn.dataset.addShape.toUpperCase() });
      });
    });

    // Pen Tool buttons
    root.querySelector('#btn-pen-close')?.addEventListener('click', () => SV.commitPenPath(true));
    root.querySelector('#btn-pen-open')?.addEventListener('click', () => SV.commitPenPath(false));
    root.querySelector('#btn-pen-clear')?.addEventListener('click', () => { SV.penState.points = []; SV.renderAll(); });

    // Brush mode buttons
    root.querySelectorAll('[data-bmode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        SV.brush.mode = btn.dataset.bmode;
        SV.refreshUI();
      });
    });
    root.querySelector('#brush-size')?.addEventListener('input', (e) => { SV.brush.size = parseInt(e.target.value, 10); });
    root.querySelector('#brush-color')?.addEventListener('input', (e) => { SV.brush.color = e.target.value; });

    // Brand Color quick apply
    root.querySelectorAll('[data-brand-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!sel) return;
        const c = btn.dataset.brandColor;
        if (sel.type === 'text') sel.textColor = c;
        else sel.fillColor = c;
        SV.renderAll();
        SV.autoSave(true);
      });
    });

    // Duplicate & Delete Layer
    root.querySelector('#btn-dup-layer')?.addEventListener('click', () => {
      if (!sel) return;
      const copy = { ...sel, id: 'lyr_' + Date.now(), name: sel.name + ' Copy', x: sel.x + 35, y: sel.y + 35 };
      SV.state.layers.unshift(copy);
      SV.state.selectedLayerId = copy.id;
      SV.autoSave(true);
      SV.renderAll();
      SV.refreshUI();
    });

    root.querySelector('#btn-del-layer')?.addEventListener('click', () => {
      if (!sel) return;
      SV.state.layers = SV.state.layers.filter((l) => l.id !== sel.id);
      SV.state.selectedLayerId = SV.state.layers[0]?.id || null;
      SV.autoSave(true);
      SV.renderAll();
      SV.refreshUI();
    });

    // Layer List Actions
    root.querySelectorAll('[data-layer-sel]').forEach((el) => {
      el.addEventListener('click', () => {
        SV.state.selectedLayerId = el.dataset.layerSel;
        SV.renderAll();
        SV.refreshUI();
      });
    });
    root.querySelectorAll('[data-layer-vis]').forEach((el) => {
      el.addEventListener('click', () => {
        const l = SV.state.layers.find((x) => x.id === el.dataset.layerVis);
        if (l) { l.visible = !l.visible; SV.renderAll(); SV.refreshUI(); }
      });
    });
    root.querySelectorAll('[data-layer-lock]').forEach((el) => {
      el.addEventListener('click', () => {
        const l = SV.state.layers.find((x) => x.id === el.dataset.layerLock);
        if (l) { l.locked = !l.locked; SV.refreshUI(); }
      });
    });
    root.querySelectorAll('[data-layer-up]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.layerUp, 10);
        if (idx > 0) {
          [SV.state.layers[idx - 1], SV.state.layers[idx]] = [SV.state.layers[idx], SV.state.layers[idx - 1]];
          SV.renderAll(); SV.refreshUI();
        }
      });
    });
    root.querySelectorAll('[data-layer-down]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.layerDown, 10);
        if (idx < SV.state.layers.length - 1) {
          [SV.state.layers[idx + 1], SV.state.layers[idx]] = [SV.state.layers[idx], SV.state.layers[idx + 1]];
          SV.renderAll(); SV.refreshUI();
        }
      });
    });
  }

  // ========================================================================
  // 5. GLOBAL EVENT WIRING & INITIALIZATION BOOTLOADER
  // ========================================================================
  async function bootShaVerse() {
    await SV.initDB();
    await SV.loadBrandKit();

    // Topbar Mode Switcher
    document.querySelectorAll('.sv-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => SV.setMode(btn.dataset.targetMode));
    });

    // Desktop Left Rail
    document.querySelectorAll('.sv-rail-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleToolTrigger(btn.dataset.tool));
    });

    // Desktop Right Panel Tabs
    document.querySelectorAll('.sv-ptab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sv-ptab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const isLayers = tab.dataset.ptab === 'layers';
        document.getElementById('desktop-inspector-content').classList.toggle('hidden', isLayers);
        document.getElementById('desktop-layers-content').classList.toggle('hidden', !isLayers);
      });
    });

    // Topbar & Stage HUD Buttons
    document.getElementById('btn-undo').addEventListener('click', SV.undo);
    document.getElementById('btn-redo').addEventListener('click', SV.redo);
    document.getElementById('btn-play-pause').addEventListener('click', SV.togglePlay);
    document.getElementById('btn-split-clip').addEventListener('click', SV.splitSelectedClip);
    document.getElementById('btn-add-keyframe').addEventListener('click', SV.toggleKeyframeAtPlayhead);
    document.getElementById('btn-beat-sync').addEventListener('click', SV.detectAudioBeats);

    document.getElementById('btn-ghost-toggle').addEventListener('click', () => {
      SV.view.ghostActive = !SV.view.ghostActive;
      document.getElementById('ghost-trackpad').classList.toggle('hidden', !SV.view.ghostActive);
      SV.renderAll();
    });
    document.getElementById('btn-ghost-close').addEventListener('click', () => {
      SV.view.ghostActive = false;
      document.getElementById('ghost-trackpad').classList.add('hidden');
      SV.renderAll();
    });

    document.getElementById('btn-guides-toggle').addEventListener('click', () => {
      SV.state.canvas.showGuides = !SV.state.canvas.showGuides;
      SV.renderAll();
    });

    document.getElementById('btn-scopes-toggle').addEventListener('click', () => {
      document.getElementById('scopes-overlay').classList.toggle('hidden');
      SV.updateScopes();
    });
    document.getElementById('btn-close-scopes').addEventListener('click', () => {
      document.getElementById('scopes-overlay').classList.add('hidden');
    });

    document.getElementById('btn-layers-mobile').addEventListener('click', () => handleToolTrigger('layers'));
    document.getElementById('btn-close-drawer').addEventListener('click', () => {
      document.getElementById('contextual-drawer').classList.add('hidden');
    });

    // Timeline Ruler Scrubbing
    document.getElementById('timeline-ruler').addEventListener('pointerdown', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      SV.seekTo((e.clientX - rect.left) / PX_PER_SEC);
    });

    // Project Title Rename
    document.getElementById('project-title').addEventListener('input', (e) => {
      SV.state.title = e.target.value;
      SV.autoSave(false);
    });

    // Modals Open/Close
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => document.getElementById(btn.dataset.close).classList.add('hidden'));
    });

    document.getElementById('btn-canvas-size').addEventListener('click', () => {
      document.getElementById('canvas-w-input').value = SV.state.canvas.width;
      document.getElementById('canvas-h-input').value = SV.state.canvas.height;
      document.getElementById('canvas-bg-input').value = SV.state.canvas.bg;
      document.getElementById('modal-canvas').classList.remove('hidden');
    });

    document.querySelectorAll('.sv-ratio-pill').forEach((p) => {
      p.addEventListener('click', () => {
        document.getElementById('canvas-w-input').value = p.dataset.w;
        document.getElementById('canvas-h-input').value = p.dataset.h;
      });
    });

    document.getElementById('btn-apply-canvas').addEventListener('click', () => {
      const nw = parseInt(document.getElementById('canvas-w-input').value, 10) || 1080;
      const nh = parseInt(document.getElementById('canvas-h-input').value, 10) || 1920;
      SV.state.canvas.bg = document.getElementById('canvas-bg-input').value;
      SV.state.canvas.transparent = document.getElementById('canvas-transparent-input').checked;
      const scaleL = document.getElementById('magic-switch-scale').checked;
      SV.magicSwitchResize(nw, nh, scaleL);
      document.getElementById('modal-canvas').classList.add('hidden');
    });

    // Projects Modal
    document.getElementById('btn-projects').addEventListener('click', async () => {
      const list = await SV.listProjects();
      const grid = document.getElementById('projects-grid');
      grid.innerHTML = list.length
        ? list
            .map(
              (p) => `
          <div class="sv-project-card">
            ${p.thumbnail ? `<img src="${p.thumbnail}" class="sv-project-thumb" />` : ''}
            <strong>${p.title}</strong>
            <span style="font-size:10px;color:var(--text-muted);">${p.canvas?.width}×${p.canvas?.height}</span>
            <button class="sv-primary-btn" data-open-proj="${p.projectId}">Open Project</button>
          </div>`
            )
            .join('')
        : '<p style="color:var(--text-muted);">No saved projects yet.</p>';

      grid.querySelectorAll('[data-open-proj]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const target = list.find((x) => x.projectId === btn.dataset.openProj);
          if (target) {
            await SV.loadProjectData(target);
            document.getElementById('modal-projects').classList.add('hidden');
          }
        });
      });
      document.getElementById('modal-projects').classList.remove('hidden');
    });

    // Quick Start Presets
    document.querySelectorAll('.sv-preset-card[data-w]').forEach((card) => {
      card.addEventListener('click', () => {
        SV.state.projectId = 'sv_' + Date.now();
        SV.state.layers = [];
        SV.state.canvas.width = parseInt(card.dataset.w, 10);
        SV.state.canvas.height = parseInt(card.dataset.h, 10);
        SV.setMode(card.dataset.mode || 'studio');
        document.getElementById('modal-projects').classList.add('hidden');
        SV.autoSave(true);
        SV.toast('🚀 New Project Ready!');
      });
    });

    // Google Drive Modal
    document.getElementById('btn-drive-sync').addEventListener('click', () => {
      document.getElementById('drive-client-id').value = localStorage.getItem('sv_drive_client_id') || '';
      document.getElementById('modal-drive').classList.remove('hidden');
    });
    document.getElementById('btn-drive-connect').addEventListener('click', SV.connectGoogleDrive);
    document.getElementById('btn-drive-backup-now').addEventListener('click', () => SV.backupToDrive());
    document.getElementById('btn-pull-drive').addEventListener('click', SV.pullFromDrive);

    // Export Modal
    document.getElementById('btn-export-open').addEventListener('click', () => {
      document.getElementById('modal-export').classList.remove('hidden');
    });
    document.getElementById('export-format').addEventListener('change', (e) => {
      document.getElementById('carousel-options').classList.toggle('hidden', e.target.value !== 'carousel');
    });
    document.getElementById('export-quality').addEventListener('input', (e) => {
      document.getElementById('export-q-val').textContent = e.target.value + '%';
    });
    document.getElementById('btn-run-export').addEventListener('click', () => SV.executeExport(false));
    document.getElementById('btn-export-to-drive').addEventListener('click', () => SV.executeExport(true));

    // File Inputs (Media, Custom Fonts, .CUBE LUTs, .shaverse JSON)
    document.getElementById('input-media').addEventListener('change', async (e) => {
      for (const file of e.target.files) {
        const assetId = 'ast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        await SV.saveAssetBlob(assetId, file, { name: file.name, type: file.type });
        const url = URL.createObjectURL(file);

        if (file.type.startsWith('image/')) {
          const img = await SV.loadImageElement(url);
          const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
          const w = Math.min(SV.state.canvas.width * 0.85, img.naturalWidth);
          SV.createLayer({ name: file.name, type: 'image', assetId, _imgEl: img, width: w, height: w * ratio });
        } else if (file.type.startsWith('video/')) {
          const vid = await SV.loadVideoElement(url);
          const ratio = vid.videoHeight / Math.max(1, vid.videoWidth);
          const w = SV.state.canvas.width;
          const dur = Math.min(60, vid.duration || 5);
          SV.state.duration = Math.max(SV.state.duration, dur);
          SV.createLayer({ name: file.name, type: 'video', assetId, _videoEl: vid, width: w, height: w * ratio, duration: dur });
          SV.setMode('timeline');
        } else if (file.type.startsWith('audio/')) {
          SV.createLayer({ name: '🎵 ' + file.name, type: 'audio', assetId, duration: 15 });
          SV.setMode('timeline');
        }
      }
      e.target.value = '';
    });

    document.getElementById('input-font').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fontName = await SV.installCustomFont(file);
      const sel = SV.getSelectedLayer();
      if (sel && sel.type === 'text') {
        sel.fontFamily = fontName;
        SV.renderAll();
      }
      SV.refreshUI();
      e.target.value = '';
    });

    document.getElementById('input-lut').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const sel = SV.getSelectedLayer();
      if (!file || !sel) return;
      const txt = await file.text();
      const lut = SV.parseCubeLUT(txt, file.name);
      if (lut) {
        sel.grade.lutData = lut;
        sel.grade.lutName = file.name;
        SV.renderAll();
        SV.refreshUI();
        SV.toast(`🎞️ Applied 3D LUT: ${file.name}`);
      } else {
        SV.toast('⚠️ Invalid .CUBE LUT file');
      }
      e.target.value = '';
    });

    document.getElementById('btn-import-json').addEventListener('click', () => {
      document.getElementById('input-project-import').click();
    });
    document.getElementById('input-project-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const proj = JSON.parse(await file.text());
      await SV.loadProjectData(proj);
      document.getElementById('modal-projects').classList.add('hidden');
      SV.toast('📂 Project Loaded!');
    });

    window.addEventListener('resize', SV.applyCanvasDimensions);

    // Load Last Recent Project or Create Welcome Starter Layer
    const existing = await SV.listProjects();
    if (existing.length > 0) {
      await SV.loadProjectData(existing[0]);
    } else {
      SV.applyCanvasDimensions();
      SV.createLayer({
        type: 'text',
        name: 'Hero Title',
        text: 'SHAVERSE\nSTUDIO OS',
        fontSize: 96,
        textStyle: 'neon',
        textColor: '#ec4899',
        width: 900,
        height: 260
      });
      SV.setMode('studio');
    }
  }

  window.addEventListener('DOMContentLoaded', bootShaVerse);
})(window.ShaVerse);