/* ==========================================================================
   ShaVerse Graphics, Vector, Photoshop & Canva Pro Engine
   ========================================================================== */

(function (SV) {
  const mainCanvas = document.getElementById('main-canvas');
  const overlayCanvas = document.getElementById('overlay-canvas');
  const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
  const octx = overlayCanvas.getContext('2d');

  // Viewport Transform State (Pinch/Zoom/Pan)
  SV.view = {
    scale: 1,
    panX: 0,
    panY: 0,
    ghostX: 540,
    ghostY: 960,
    ghostActive: false
  };

  // Active Drawing / Pen / Mask State
  SV.brush = {
    mode: 'paint', // 'paint' | 'erase' | 'mask-hide' | 'mask-reveal' | 'heal' | 'dodge' | 'burn'
    size: 36,
    hardness: 0.8,
    color: '#ec4899',
    opacity: 1
  };

  SV.penState = {
    points: [],
    closed: false
  };

  const BLEND_MODES = [
    'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
    'exclusion', 'hue', 'saturation', 'color', 'luminosity'
  ];

  SV.BLEND_LABELS = {
    'source-over': 'Normal',
    'multiply': 'Multiply',
    'screen': 'Screen',
    'overlay': 'Overlay',
    'darken': 'Darken',
    'lighten': 'Lighten',
    'color-dodge': 'Color Dodge',
    'color-burn': 'Color Burn',
    'hard-light': 'Hard Light',
    'soft-light': 'Soft Light',
    'difference': 'Difference',
    'exclusion': 'Exclusion',
    'hue': 'Hue',
    'saturation': 'Saturation',
    'color': 'Color',
    'luminosity': 'Luminosity'
  };

  // Default Color Grade Object for Every Layer
  SV.createDefaultGrade = function () {
    return {
      exposure: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      highlights: 0,
      shadows: 0,
      clarity: 0,
      vignette: 0,
      blur: 0,
      lift: { r: 0, g: 0, b: 0 },
      gamma: { r: 0, g: 0, b: 0 },
      gain: { r: 0, g: 0, b: 0 },
      curves: {
        rgb: [[0, 0], [128, 128], [255, 255]],
        r: [[0, 0], [255, 255]],
        g: [[0, 0], [255, 255]],
        b: [[0, 0], [255, 255]]
      },
      hsl: {
        red: { h: 0, s: 0, l: 0 },
        yellow: { h: 0, s: 0, l: 0 },
        green: { h: 0, s: 0, l: 0 },
        cyan: { h: 0, s: 0, l: 0 },
        blue: { h: 0, s: 0, l: 0 },
        magenta: { h: 0, s: 0, l: 0 }
      },
      lutData: null,
      lutName: '',
      lutIntensity: 1,
      chromaKey: { enabled: false, color: '#00ff00', tolerance: 60, feather: 10 }
    };
  };

  // Factory for Creating New Layers
  SV.createLayer = function (opts = {}) {
    const cw = SV.state.canvas.width;
    const ch = SV.state.canvas.height;
    const id = 'lyr_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    const base = {
      id,
      name: opts.name || 'Layer ' + (SV.state.layers.length + 1),
      type: opts.type || 'shape', // 'text' | 'image' | 'video' | 'shape' | 'vector' | 'paint' | 'audio'
      x: opts.x !== undefined ? opts.x : cw / 2,
      y: opts.y !== undefined ? opts.y : ch / 2,
      width: opts.width || 420,
      height: opts.height || 420,
      rotation: opts.rotation || 0,
      scaleX: opts.scaleX || 1,
      scaleY: opts.scaleY || 1,
      opacity: opts.opacity !== undefined ? opts.opacity : 1,
      blendMode: opts.blendMode || 'source-over',
      visible: true,
      locked: false,
      startTime: opts.startTime || 0,
      duration: opts.duration || 5,
      speed: 1,
      keyframes: [], // [{ time, x, y, scaleX, scaleY, rotation, opacity, ease }]
      grade: SV.createDefaultGrade(),
      // Text Properties
      text: opts.text || 'ShaVerse Studio',
      fontFamily: opts.fontFamily || 'Montserrat',
      fontSize: opts.fontSize || 84,
      fontWeight: opts.fontWeight || '800',
      textColor: opts.textColor || '#ffffff',
      textGradient: opts.textGradient || '',
      textAlign: opts.textAlign || 'center',
      letterSpacing: opts.letterSpacing || 0,
      lineHeight: opts.lineHeight || 1.15,
      textStyle: opts.textStyle || 'none', // 'none' | 'neon' | 'outline' | '3d' | 'shadow'
      textCurve: opts.textCurve || 0, // -100 to 100
      // Shape / Vector Properties
      shapeType: opts.shapeType || 'rect', // 'rect' | 'circle' | 'star' | 'triangle' | 'badge' | 'path'
      fillColor: opts.fillColor || '#8b5cf6',
      strokeColor: opts.strokeColor || '#ffffff',
      strokeWidth: opts.strokeWidth || 0,
      cornerRadius: opts.cornerRadius || 24,
      pathPoints: opts.pathPoints || [],
      // Media References
      assetId: opts.assetId || null,
      _imgEl: opts._imgEl || null,
      _videoEl: opts._videoEl || null,
      _maskCanvas: opts._maskCanvas || null
    };

    SV.state.layers.unshift(base);
    SV.state.selectedLayerId = base.id;
    SV.autoSave(true);
    SV.renderAll();
    SV.refreshUI();
    return base;
  };

  SV.getSelectedLayer = function () {
    return SV.state.layers.find((l) => l.id === SV.state.selectedLayerId) || null;
  };

  // Fit Canvas Nicely in Viewport
  SV.applyCanvasDimensions = function () {
    const { width, height } = SV.state.canvas;
    mainCanvas.width = width;
    mainCanvas.height = height;
    overlayCanvas.width = width;
    overlayCanvas.height = height;

    const pill = document.getElementById('btn-canvas-size');
    if (pill) pill.textContent = `📐 ${width} × ${height}`;

    const vp = document.getElementById('canvas-viewport');
    const wrap = document.getElementById('canvas-wrapper');
    if (vp && wrap) {
      const availW = vp.clientWidth - 28;
      const availH = vp.clientHeight - 28;
      const fitScale = Math.min(availW / width, availH / height, 1);
      wrap.style.width = Math.round(width * fitScale) + 'px';
      wrap.style.height = Math.round(height * fitScale) + 'px';
      mainCanvas.style.width = '100%';
      mainCanvas.style.height = '100%';
    }
    SV.renderAll();
  };

  // Magic Switch Auto-Resize
  SV.magicSwitchResize = function (newW, newH, scaleLayers = true) {
    const oldW = SV.state.canvas.width;
    const oldH = SV.state.canvas.height;
    SV.state.canvas.width = newW;
    SV.state.canvas.height = newH;

    if (scaleLayers && oldW > 0 && oldH > 0) {
      const rx = newW / oldW;
      const ry = newH / oldH;
      const uniform = Math.min(rx, ry);
      for (const l of SV.state.layers) {
        l.x *= rx;
        l.y *= ry;
        l.width *= uniform;
        l.height *= uniform;
        if (l.type === 'text') {
          l.fontSize = Math.max(12, Math.round(l.fontSize * uniform));
        }
      }
    }
    SV.applyCanvasDimensions();
    SV.autoSave(true);
    SV.toast(`✨ Magic Switch applied: ${newW}×${newH}`);
  };

  // Keyframe Interpolation Helper (Called during Playback/Scrub)
  SV.evaluateLayerAtTime = function (layer, t) {
    const props = {
      x: layer.x,
      y: layer.y,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      rotation: layer.rotation,
      opacity: layer.opacity
    };
    if (!layer.keyframes || layer.keyframes.length === 0) return props;

    const kfs = [...layer.keyframes].sort((a, b) => a.time - b.time);
    if (t <= kfs[0].time) return { ...props, ...kfs[0] };
    if (t >= kfs[kfs.length - 1].time) return { ...props, ...kfs[kfs.length - 1] };

    for (let i = 0; i < kfs.length - 1; i++) {
      const k1 = kfs[i];
      const k2 = kfs[i + 1];
      if (t >= k1.time && t <= k2.time) {
        let p = (t - k1.time) / Math.max(0.0001, k2.time - k1.time);
        // Smooth Cubic Ease-In-Out Interpolation
        if (k1.ease === 'ease-in-out') {
          p = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        } else if (k1.ease === 'bounce') {
          p = 1 - Math.pow(1 - p, 3) * Math.cos(p * Math.PI * 2);
        }
        const lerp = (a, b) => a + (b - a) * p;
        return {
          x: lerp(k1.x, k2.x),
          y: lerp(k1.y, k2.y),
          scaleX: lerp(k1.scaleX, k2.scaleX),
          scaleY: lerp(k1.scaleY, k2.scaleY),
          rotation: lerp(k1.rotation, k2.rotation),
          opacity: lerp(k1.opacity, k2.opacity)
        };
      }
    }
    return props;
  };

  // ========================================================================
  // MASTER COMPOSITOR RENDER PIPELINE
  // ========================================================================
  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

  SV.renderAll = function () {
    const { width, height, bg, transparent } = SV.state.canvas;
    ctx.clearRect(0, 0, width, height);

    if (!transparent) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }

    const t = SV.state.currentTime;
    const isTimeline = SV.state.mode === 'timeline';

    // Render Bottom-to-Top
    for (let i = SV.state.layers.length - 1; i >= 0; i--) {
      const layer = SV.state.layers[i];
      if (!layer.visible || layer.type === 'audio') continue;

      if (isTimeline) {
        if (t < layer.startTime || t > layer.startTime + layer.duration) continue;
      }

      const anim = isTimeline ? SV.evaluateLayerAtTime(layer, t) : layer;
      renderSingleLayer(ctx, layer, anim);
    }

    renderSelectionOverlay();
    if (SV.updateScopes) SV.updateScopes();
    if (SV.view.ghostActive) updateGhostLoupe();
  };

  function renderSingleLayer(targetCtx, layer, anim) {
    const w = Math.max(4, Math.round(layer.width));
    const h = Math.max(4, Math.round(layer.height));
    offCanvas.width = w;
    offCanvas.height = h;
    offCtx.clearRect(0, 0, w, h);

    // 1. Draw Base Content onto Offscreen Layer Buffer
    if (layer.type === 'image' && layer._imgEl) {
      offCtx.drawImage(layer._imgEl, 0, 0, w, h);
    } else if (layer.type === 'video' && layer._videoEl) {
      try {
        offCtx.drawImage(layer._videoEl, 0, 0, w, h);
      } catch (e) {}
    } else if (layer.type === 'paint' && layer._paintCanvas) {
      offCtx.drawImage(layer._paintCanvas, 0, 0, w, h);
    } else if (layer.type === 'shape') {
      drawShape(offCtx, layer, w, h);
    } else if (layer.type === 'vector') {
      drawVectorPath(offCtx, layer, w, h);
    } else if (layer.type === 'text') {
      drawStyledText(offCtx, layer, w, h);
    }

    // 2. Apply Color Grading, Curves, HSL, LUTs & Chroma Key (via engine-color-video.js)
    if (SV.applyColorPipeline && hasActiveColorGrade(layer.grade)) {
      SV.applyColorPipeline(offCtx, w, h, layer.grade);
    }

    // 3. Apply Non-Destructive Layer Mask (Photoshop Alpha Mask)
    if (layer._maskCanvas) {
      offCtx.globalCompositeOperation = 'destination-in';
      offCtx.drawImage(layer._maskCanvas, 0, 0, w, h);
      offCtx.globalCompositeOperation = 'source-over';
    }

    // 4. Composite onto Master Canvas with Transform & Blend Mode
    targetCtx.save();
    targetCtx.globalAlpha = Math.max(0, Math.min(1, anim.opacity));
    targetCtx.globalCompositeOperation = layer.blendMode || 'source-over';
    targetCtx.translate(anim.x, anim.y);
    targetCtx.rotate((anim.rotation * Math.PI) / 180);
    targetCtx.scale(anim.scaleX, anim.scaleY);
    targetCtx.drawImage(offCanvas, -w / 2, -h / 2, w, h);
    targetCtx.restore();
  }

  function hasActiveColorGrade(g) {
    if (!g) return false;
    return (
      g.exposure !== 0 || g.contrast !== 0 || g.saturation !== 0 ||
      g.temperature !== 0 || g.tint !== 0 || g.highlights !== 0 ||
      g.shadows !== 0 || g.blur > 0 || g.vignette > 0 ||
      g.lift.r !== 0 || g.lift.g !== 0 || g.lift.b !== 0 ||
      g.gamma.r !== 0 || g.gamma.g !== 0 || g.gamma.b !== 0 ||
      g.gain.r !== 0 || g.gain.g !== 0 || g.gain.b !== 0 ||
      g.lutData !== null || (g.chromaKey && g.chromaKey.enabled) ||
      g.curves.rgb.length > 3 || g.curves.rgb[1][1] !== 128
    );
  }

  // Draw Geometric & Canva Elements
  function drawShape(c, layer, w, h) {
    c.save();
    c.fillStyle = layer.fillColor;
    c.strokeStyle = layer.strokeColor;
    c.lineWidth = layer.strokeWidth || 0;
    const pad = c.lineWidth / 2;

    c.beginPath();
    if (layer.shapeType === 'circle') {
      c.ellipse(w / 2, h / 2, w / 2 - pad, h / 2 - pad, 0, 0, Math.PI * 2);
    } else if (layer.shapeType === 'triangle') {
      c.moveTo(w / 2, pad);
      c.lineTo(w - pad, h - pad);
      c.lineTo(pad, h - pad);
      c.closePath();
    } else if (layer.shapeType === 'star') {
      const spikes = 5;
      const outerR = Math.min(w, h) / 2 - pad;
      const innerR = outerR * 0.45;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const px = w / 2 + Math.cos(angle) * r;
        const py = h / 2 + Math.sin(angle) * r;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
    } else {
      const r = Math.min(layer.cornerRadius || 0, w / 2, h / 2);
      c.roundRect(pad, pad, w - pad * 2, h - pad * 2, r);
    }
    c.fill();
    if (c.lineWidth > 0) c.stroke();
    c.restore();
  }

  // Draw Illustrator Bezier Vector Path
  function drawVectorPath(c, layer, w, h) {
    if (!layer.pathPoints || layer.pathPoints.length < 2) return;
    c.save();
    c.beginPath();
    layer.pathPoints.forEach((pt, idx) => {
      if (idx === 0) c.moveTo(pt.x, pt.y);
      else c.lineTo(pt.x, pt.y);
    });
    if (layer.closed) c.closePath();
    if (layer.fillColor && layer.closed) {
      c.fillStyle = layer.fillColor;
      c.fill();
    }
    c.strokeStyle = layer.strokeColor || '#ffffff';
    c.lineWidth = layer.strokeWidth || 6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.stroke();
    c.restore();
  }

  // Draw Canva Pro Typography (Curve, Neon, 3D Extrude, Gradient, Tamil Unicode)
  function drawStyledText(c, layer, w, h) {
    c.save();
    const fontStr = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
    c.font = fontStr;
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    if (layer.textStyle === 'neon') {
      c.shadowColor = layer.textColor;
      c.shadowBlur = 28;
    } else if (layer.textStyle === 'shadow') {
      c.shadowColor = 'rgba(0,0,0,0.75)';
      c.shadowBlur = 14;
      c.shadowOffsetX = 6;
      c.shadowOffsetY = 8;
    } else if (layer.textStyle === '3d') {
      c.fillStyle = 'rgba(0,0,0,0.65)';
      for (let d = 1; d <= 8; d++) {
        c.fillText(layer.text, w / 2 + d, h / 2 + d);
      }
    }

    if (layer.textGradient) {
      const grad = c.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#a855f7');
      grad.addColorStop(0.5, '#ec4899');
      grad.addColorStop(1, '#f59e0b');
      c.fillStyle = grad;
    } else {
      c.fillStyle = layer.textColor;
    }

    if (layer.textCurve && layer.textCurve !== 0) {
      // Curved / Arc Text Engine
      const chars = [...layer.text];
      const radius = Math.max(120, 600 - Math.abs(layer.textCurve) * 4.5);
      const dir = layer.textCurve > 0 ? 1 : -1;
      const totalAngle = (chars.length * layer.fontSize * 0.62) / radius;
      let startAngle = -totalAngle / 2;

      chars.forEach((ch) => {
        const charAngle = (layer.fontSize * 0.62) / radius;
        const theta = startAngle + charAngle / 2;
        c.save();
        c.translate(w / 2 + Math.sin(theta) * radius, h / 2 + dir * (radius - Math.cos(theta) * radius));
        c.rotate(dir * theta);
        if (layer.textStyle === 'outline') {
          c.strokeStyle = layer.textColor;
          c.lineWidth = 3;
          c.strokeText(ch, 0, 0);
        } else {
          c.fillText(ch, 0, 0);
        }
        c.restore();
        startAngle += charAngle;
      });
    } else {
      const lines = layer.text.split('\n');
      const lh = layer.fontSize * (layer.lineHeight || 1.15);
      const startY = h / 2 - ((lines.length - 1) * lh) / 2;
      lines.forEach((line, idx) => {
        const ly = startY + idx * lh;
        if (layer.textStyle === 'outline') {
          c.strokeStyle = layer.textColor;
          c.lineWidth = 3;
          c.strokeText(line, w / 2, ly);
        } else {
          c.fillText(line, w / 2, ly);
        }
      });
    }
    c.restore();
  }

  // Selection Bounding Box, Snapping Guides & Pen Nodes
  function renderSelectionOverlay() {
    const { width, height, showGuides } = SV.state.canvas;
    octx.clearRect(0, 0, width, height);

    if (showGuides) {
      octx.save();
      octx.strokeStyle = 'rgba(139, 92, 246, 0.25)';
      octx.lineWidth = 2;
      octx.setLineDash([10, 10]);
      // Center Crosshair
      octx.beginPath();
      octx.moveTo(width / 2, 0);
      octx.lineTo(width / 2, height);
      octx.moveTo(0, height / 2);
      octx.lineTo(width, height / 2);
      octx.stroke();
      // Safe Margin Box (5%)
      octx.strokeRect(width * 0.05, height * 0.05, width * 0.9, height * 0.9);
      octx.restore();
    }

    // Active Pen Tool Path Preview
    if (SV.state.activeTool === 'pen' && SV.penState.points.length > 0) {
      octx.save();
      octx.strokeStyle = '#f59e0b';
      octx.lineWidth = 4;
      octx.beginPath();
      SV.penState.points.forEach((p, i) => {
        if (i === 0) octx.moveTo(p.x, p.y);
        else octx.lineTo(p.x, p.y);
      });
      octx.stroke();
      SV.penState.points.forEach((p) => {
        octx.fillStyle = '#ffffff';
        octx.fillRect(p.x - 8, p.y - 8, 16, 16);
      });
      octx.restore();
    }

    // Selected Layer Bounding Box
    const sel = SV.getSelectedLayer();
    if (sel && sel.visible && sel.type !== 'audio') {
      octx.save();
      octx.translate(sel.x, sel.y);
      octx.rotate((sel.rotation * Math.PI) / 180);
      octx.scale(sel.scaleX, sel.scaleY);
      octx.strokeStyle = '#a855f7';
      octx.lineWidth = 4;
      octx.strokeRect(-sel.width / 2, -sel.height / 2, sel.width, sel.height);

      // Corner Handles
      const corners = [
        [-sel.width / 2, -sel.height / 2],
        [sel.width / 2, -sel.height / 2],
        [sel.width / 2, sel.height / 2],
        [-sel.width / 2, sel.height / 2]
      ];
      octx.fillStyle = '#ffffff';
      corners.forEach(([cx, cy]) => {
        octx.beginPath();
        octx.arc(cx, cy, 12, 0, Math.PI * 2);
        octx.fill();
        octx.stroke();
      });
      octx.restore();
    }

    // Ghost Cursor Crosshair
    if (SV.view.ghostActive) {
      octx.save();
      octx.strokeStyle = '#10b981';
      octx.lineWidth = 3;
      octx.beginPath();
      octx.arc(SV.view.ghostX, SV.view.ghostY, 18, 0, Math.PI * 2);
      octx.moveTo(SV.view.ghostX - 28, SV.view.ghostY);
      octx.lineTo(SV.view.ghostX + 28, SV.view.ghostY);
      octx.moveTo(SV.view.ghostX, SV.view.ghostY - 28);
      octx.lineTo(SV.view.ghostX, SV.view.ghostY + 28);
      octx.stroke();
      octx.restore();
    }
  }

  // ========================================================================
  // 1-CLICK LOCAL AI SUBJECT CUTOUT / BACKGROUND REMOVER
  // ========================================================================
  SV.removeBackgroundSmart = function () {
    const sel = SV.getSelectedLayer();
    if (!sel || sel.type !== 'image' || !sel._imgEl) {
      SV.toast('⚠️ Select an Image layer first');
      return;
    }
    SV.toast('🪄 Removing background...');
    const w = sel._imgEl.naturalWidth || sel.width;
    const h = sel._imgEl.naturalHeight || sel.height;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(sel._imgEl, 0, 0, w, h);

    const imgData = tctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Sample 4 corner pixels as background reference
    const corners = [
      0,
      (w - 1) * 4,
      (h - 1) * w * 4,
      ((h - 1) * w + (w - 1)) * 4
    ];
    let bgR = 0, bgG = 0, bgB = 0;
    corners.forEach((idx) => {
      bgR += d[idx];
      bgG += d[idx + 1];
      bgB += d[idx + 2];
    });
    bgR /= 4; bgG /= 4; bgB /= 4;

    const tol = 58;
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.hypot(d[i] - bgR, d[i + 1] - bgG, d[i + 2] - bgB);
      if (dist < tol) {
        d[i + 3] = 0;
      } else if (dist < tol + 22) {
        d[i + 3] = Math.round(((dist - tol) / 22) * 255);
      }
    }
    tctx.putImageData(imgData, 0, 0);

    // Create Non-Destructive Mask from Alpha
    const maskC = document.createElement('canvas');
    maskC.width = sel.width;
    maskC.height = sel.height;
    maskC.getContext('2d').drawImage(tmp, 0, 0, sel.width, sel.height);
    sel._maskCanvas = maskC;

    SV.autoSave(true);
    SV.renderAll();
    SV.toast('✨ Background Cutout Applied (Editable via Mask Brush!)');
  };

  // ========================================================================
  // TOUCH / POINTER INTERACTION, PINCH ZOOM, BRUSH & PEN TOOL
  // ========================================================================
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let layerStart = { x: 0, y: 0 };
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let twoFingerStartTime = 0;

  function clientToCanvas(clientX, clientY) {
    const rect = overlayCanvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * SV.state.canvas.width;
    const y = ((clientY - rect.top) / rect.height) * SV.state.canvas.height;
    return { x, y };
  }

  overlayCanvas.addEventListener('pointerdown', (e) => {
    const pt = clientToCanvas(e.clientX, e.clientY);
    handleCanvasActionDown(pt.x, pt.y);
  });

  overlayCanvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const pt = clientToCanvas(e.clientX, e.clientY);
    handleCanvasActionMove(pt.x, pt.y);
  });

  overlayCanvas.addEventListener('pointerup', () => {
    if (isDragging) {
      isDragging = false;
      SV.autoSave(true);
    }
  });

  // Multi-Touch Gestures (Pinch Zoom + 2-Finger Undo + 3-Finger Redo)
  const vp = document.getElementById('canvas-viewport');
  vp.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      twoFingerStartTime = Date.now();
      pinchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartScale = SV.view.scale;
    } else if (e.touches.length === 3) {
      SV.redo();
    }
  }, { passive: true });

  vp.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      SV.view.scale = Math.max(0.3, Math.min(4, pinchStartScale * (dist / pinchStartDist)));
      document.getElementById('canvas-wrapper').style.transform =
        `translate(${SV.view.panX}px, ${SV.view.panY}px) scale(${SV.view.scale})`;
    }
  }, { passive: true });

  vp.addEventListener('touchend', (e) => {
    if (e.touches.length === 0 && Date.now() - twoFingerStartTime < 220 && pinchStartDist > 0) {
      SV.undo();
    }
    pinchStartDist = 0;
  });

  function handleCanvasActionDown(cx, cy) {
    const tool = SV.state.activeTool;

    if (tool === 'pen') {
      SV.penState.points.push({ x: cx, y: cy });
      SV.renderAll();
      return;
    }

    if (tool === 'brush' || tool === 'retouch') {
      isDragging = true;
      applyBrushStroke(cx, cy);
      return;
    }

    // Select / Hit-Test Topmost Layer
    for (let i = 0; i < SV.state.layers.length; i++) {
      const l = SV.state.layers[i];
      if (!l.visible || l.locked || l.type === 'audio') continue;
      const hw = (l.width * l.scaleX) / 2;
      const hh = (l.height * l.scaleY) / 2;
      if (cx >= l.x - hw && cx <= l.x + hw && cy >= l.y - hh && cy <= l.y + hh) {
        SV.state.selectedLayerId = l.id;
        isDragging = true;
        dragStart = { x: cx, y: cy };
        layerStart = { x: l.x, y: l.y };
        SV.renderAll();
        SV.refreshUI();
        return;
      }
    }
  }

  function handleCanvasActionMove(cx, cy) {
    const tool = SV.state.activeTool;
    if (tool === 'brush' || tool === 'retouch') {
      applyBrushStroke(cx, cy);
      return;
    }
    const sel = SV.getSelectedLayer();
    if (!sel || sel.locked) return;

    let nx = layerStart.x + (cx - dragStart.x);
    let ny = layerStart.y + (cy - dragStart.y);

    // Magnetic Center Snapping (12px threshold)
    const midX = SV.state.canvas.width / 2;
    const midY = SV.state.canvas.height / 2;
    if (Math.abs(nx - midX) < 14) nx = midX;
    if (Math.abs(ny - midY) < 14) ny = midY;

    sel.x = Math.round(nx);
    sel.y = Math.round(ny);
    SV.renderAll();
  }

  function applyBrushStroke(cx, cy) {
    let sel = SV.getSelectedLayer();
    const b = SV.brush;

    // Mask Painting Mode
    if (b.mode === 'mask-hide' || b.mode === 'mask-reveal') {
      if (!sel) return;
      if (!sel._maskCanvas) {
        const mc = document.createElement('canvas');
        mc.width = sel.width;
        mc.height = sel.height;
        const mctx = mc.getContext('2d');
        mctx.fillStyle = '#ffffff';
        mctx.fillRect(0, 0, mc.width, mc.height);
        sel._maskCanvas = mc;
      }
      const lx = cx - (sel.x - sel.width / 2);
      const ly = cy - (sel.y - sel.height / 2);
      const mctx = sel._maskCanvas.getContext('2d');
      mctx.globalCompositeOperation = b.mode === 'mask-hide' ? 'destination-out' : 'source-over';
      mctx.fillStyle = '#ffffff';
      mctx.beginPath();
      mctx.arc(lx, ly, b.size / 2, 0, Math.PI * 2);
      mctx.fill();
      SV.renderAll();
      return;
    }

    // Freehand Paint Layer
    if (!sel || sel.type !== 'paint') {
      const pc = document.createElement('canvas');
      pc.width = SV.state.canvas.width;
      pc.height = SV.state.canvas.height;
      sel = SV.createLayer({
        name: 'Paint Layer',
        type: 'paint',
        x: pc.width / 2,
        y: pc.height / 2,
        width: pc.width,
        height: pc.height
      });
      sel._paintCanvas = pc;
    }

    const pctx = sel._paintCanvas.getContext('2d');
    pctx.save();
    if (b.mode === 'erase') {
      pctx.globalCompositeOperation = 'destination-out';
    } else if (b.mode === 'dodge') {
      pctx.globalCompositeOperation = 'screen';
      pctx.fillStyle = 'rgba(255,255,255,0.15)';
    } else if (b.mode === 'burn') {
      pctx.globalCompositeOperation = 'multiply';
      pctx.fillStyle = 'rgba(0,0,0,0.2)';
    } else {
      pctx.globalAlpha = b.opacity;
      pctx.fillStyle = b.color;
    }
    pctx.beginPath();
    pctx.arc(cx, cy, b.size / 2, 0, Math.PI * 2);
    pctx.fill();
    pctx.restore();
    SV.renderAll();
  }

  // Finalize Bezier Pen Shape
  SV.commitPenPath = function (closePath = true) {
    if (SV.penState.points.length < 2) return;
    const pts = SV.penState.points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 20;
    const minY = Math.min(...ys) - 20;
    const w = Math.max(40, Math.max(...xs) - minX + 20);
    const h = Math.max(40, Math.max(...ys) - minY + 20);

    const relPts = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    SV.createLayer({
      name: 'Vector Path',
      type: 'vector',
      x: minX + w / 2,
      y: minY + h / 2,
      width: w,
      height: h,
      pathPoints: relPts,
      closed: closePath,
      fillColor: '#ec4899',
      strokeColor: '#ffffff',
      strokeWidth: 6
    });
    SV.penState.points = [];
    SV.state.activeTool = 'select';
    SV.toast('✒️ Vector Shape Created!');
  };

  // Ghost Trackpad + 2x Zoom Loupe Logic
  function updateGhostLoupe() {
    const loupe = document.getElementById('loupe-canvas');
    if (!loupe) return;
    const lctx = loupe.getContext('2d');
    lctx.clearRect(0, 0, 100, 100);
    lctx.drawImage(
      mainCanvas,
      SV.view.ghostX - 25,
      SV.view.ghostY - 25,
      50,
      50,
      0,
      0,
      100,
      100
    );
    lctx.strokeStyle = '#10b981';
    lctx.lineWidth = 1;
    lctx.beginPath();
    lctx.moveTo(50, 0); lctx.lineTo(50, 100);
    lctx.moveTo(0, 50); lctx.lineTo(100, 50);
    lctx.stroke();

    const coordEl = document.getElementById('ghost-coords');
    if (coordEl) coordEl.textContent = `X:${Math.round(SV.view.ghostX)} Y:${Math.round(SV.view.ghostY)}`;
  }

  let ghostLastTouch = null;
  const ghostArea = document.getElementById('ghost-touch-area');
  if (ghostArea) {
    ghostArea.addEventListener('touchstart', (e) => {
      ghostLastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    });
    ghostArea.addEventListener('touchmove', (e) => {
      if (!ghostLastTouch) return;
      const dx = (e.touches[0].clientX - ghostLastTouch.x) * 1.5;
      const dy = (e.touches[0].clientY - ghostLastTouch.y) * 1.5;
      ghostLastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      SV.view.ghostX = Math.max(0, Math.min(SV.state.canvas.width, SV.view.ghostX + dx));
      SV.view.ghostY = Math.max(0, Math.min(SV.state.canvas.height, SV.view.ghostY + dy));
      if (isDragging) handleCanvasActionMove(SV.view.ghostX, SV.view.ghostY);
      SV.renderAll();
    });
    ghostArea.addEventListener('click', () => {
      handleCanvasActionDown(SV.view.ghostX, SV.view.ghostY);
      isDragging = false;
      SV.autoSave(true);
    });
  }

  SV.BLEND_MODES = BLEND_MODES;
})(window.ShaVerse);