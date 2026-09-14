// ===========================================================================
// Automatic Panorama Stitcher
// Computer Vision Pipeline: Multi-image ORB, BFMatcher, RANSAC Homography,
// Global Coordinate Warping, and Multi-Image Seamless Distance Transform Blending
// ===========================================================================

// ---------------------------------------------------------------------------
// Global State
// ---------------------------------------------------------------------------

let cvReady = false;
let dragSrcIndex = null;

const state = {
  frames: [],            // Array of { id, file, url, name }
  pairsData: [],         // Array of CV metadata per adjacent pair
  currentResultMat: null,// Current final cv.Mat (for auto-crop / download)
  blendedDataUrl: null,  // Data URL of blended panorama
  hardCutMat: null,      // Hard cut / unblended Mat for live comparison toggle
  isProcessing: false,
};

// UI Element References
const els = {
  // Status
  runtimeBadge: document.getElementById('runtimeStatusBadge'),
  runtimeText: document.getElementById('runtimeStatusText'),
  processStatus: document.getElementById('processStatus'),
  execMetricsBadge: document.getElementById('execMetricsBadge'),

  // Inputs
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  browseBtn: document.getElementById('browseBtn'),
  loadSampleBtn: document.getElementById('loadSampleBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  filmstrip: document.getElementById('filmstrip'),
  filmstripEmpty: document.getElementById('filmstripEmpty'),
  frameCountBadge: document.getElementById('frameCountBadge'),

  // Configs
  blendModeSelect: document.getElementById('blendModeSelect'),
  maxFeaturesSelect: document.getElementById('maxFeaturesSelect'),
  ransacThreshSelect: document.getElementById('ransacThreshSelect'),
  autoCropCheckbox: document.getElementById('autoCropCheckbox'),

  // Actions
  stitchBtn: document.getElementById('stitchBtn'),
  downloadBtn: document.getElementById('downloadBtn'),

  // Tabs & Views
  tabButtons: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  matchesCountPill: document.getElementById('matchesCountPill'),

  // Panorama Output Tab
  outputCanvas: document.getElementById('outputCanvas'),
  outputPlaceholder: document.getElementById('outputPlaceholder'),
  resMeta: document.getElementById('resMeta'),
  blendMeta: document.getElementById('blendMeta'),
  toggleCompareBtn: document.getElementById('toggleCompareBtn'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),

  // Matches Tab
  pairSelect: document.getElementById('pairSelect'),
  statTotalMatches: document.getElementById('statTotalMatches'),
  statInliers: document.getElementById('statInliers'),
  statInlierRatio: document.getElementById('statInlierRatio'),
  matchesCanvas: document.getElementById('matchesCanvas'),
  matchesPlaceholder: document.getElementById('matchesPlaceholder'),

  // Homography Tab
  homographyPairSelect: document.getElementById('homographyPairSelect'),
  matrixValuesGrid: document.getElementById('matrixValuesGrid'),
  transVal: document.getElementById('transVal'),
  scaleVal: document.getElementById('scaleVal'),
  projVal: document.getElementById('projVal'),
};

// ---------------------------------------------------------------------------
// OpenCV Runtime Handshake
// ---------------------------------------------------------------------------

window.onOpenCvReady = function () {
  cvReady = true;
  if (els.runtimeBadge) {
    els.runtimeBadge.className = 'status-pill status-ready';
    els.runtimeText.textContent = 'OpenCV.js พร้อมใช้งาน';
  }
  setProcessStatus(state.frames.length >= 2 ? 'พร้อมประกบภาพ' : 'OpenCV พร้อมแล้ว เพิ่มรูปภาพเพื่อเริ่มต้น');
  refreshControls();
};

function setProcessStatus(msg, isError = false) {
  if (!els.processStatus) return;
  els.processStatus.textContent = msg;
  els.processStatus.className = 'process-status' + (isError ? ' error' : state.isProcessing ? ' active' : '');
}

function tick() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function refreshControls() {
  const enough = state.frames.length >= 2;
  els.stitchBtn.disabled = !(enough && cvReady && !state.isProcessing);
  els.clearAllBtn.disabled = state.frames.length === 0 || state.isProcessing;
  els.loadSampleBtn.disabled = state.isProcessing;
  els.frameCountBadge.textContent = `${state.frames.length} ภาพ`;
  if (els.filmstripEmpty) {
    els.filmstripEmpty.classList.toggle('active', state.frames.length === 0);
  }
}

// ---------------------------------------------------------------------------
// File Handling & Filmstrip
// ---------------------------------------------------------------------------

function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;

  for (const file of files) {
    state.frames.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      url: URL.createObjectURL(file),
    });
  }
  renderFilmstrip();
  refreshControls();
  setProcessStatus(`เพิ่ม ${files.length} รูปเรียบร้อย — มีทั้งหมด ${state.frames.length} รูป`);
}

els.browseBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});

// Dropzone drag & drop
['dragenter', 'dragover'].forEach((evt) => {
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('drag-over');
  });
});
els.dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) {
    addFiles(e.dataTransfer.files);
  }
});
els.dropzone.addEventListener('click', (e) => {
  if (e.target !== els.browseBtn) els.fileInput.click();
});

// Sample images loader (1.jpg, 2.jpg, 3.jpg)
async function loadSamplePreset() {
  const sampleNames = ['1.jpg', '2.jpg', '3.jpg'];
  setProcessStatus('กำลังโหลดภาพตัวอย่าง 1.jpg, 2.jpg, 3.jpg...');
  try {
    state.frames.forEach((f) => URL.revokeObjectURL(f.url));
    state.frames = [];

    for (let i = 0; i < sampleNames.length; i++) {
      const name = sampleNames[i];
      const resp = await fetch(name);
      if (!resp.ok) throw new Error(`ไม่พบไฟล์ตัวอย่าง ${name}`);
      const blob = await resp.blob();
      const file = new File([blob], name, { type: 'image/jpeg' });
      state.frames.push({
        id: `sample-${i}-${Date.now()}`,
        file,
        name,
        url: URL.createObjectURL(file),
      });
    }

    renderFilmstrip();
    refreshControls();
    setProcessStatus('โหลดภาพตัวอย่าง 3 ภาพเสร็จสิ้น — กด "ประกบภาพพาโนรามา" ได้เลย!');
  } catch (err) {
    console.error(err);
    setProcessStatus(`เกิดข้อผิดพลาดในการโหลดตัวอย่าง: ${err.message}`, true);
  }
}
els.loadSampleBtn.addEventListener('click', loadSamplePreset);

// Clear All
els.clearAllBtn.addEventListener('click', () => {
  state.frames.forEach((f) => URL.revokeObjectURL(f.url));
  state.frames = [];
  state.pairsData = [];
  if (state.currentResultMat) {
    try { state.currentResultMat.delete(); } catch (_) {}
    state.currentResultMat = null;
  }
  if (state.hardCutMat) {
    try { state.hardCutMat.delete(); } catch (_) {}
    state.hardCutMat = null;
  }
  renderFilmstrip();
  refreshControls();
  clearOutput();
  setProcessStatus('ล้างข้อมูลทั้งหมดแล้ว');
});

// Render Filmstrip with drag-to-reorder
function renderFilmstrip() {
  els.filmstrip.innerHTML = '';
  state.frames.forEach((frame, i) => {
    const li = document.createElement('li');
    li.className = 'frame-card';
    li.draggable = true;
    li.dataset.index = String(i);

    const img = document.createElement('img');
    img.src = frame.url;
    img.alt = frame.name || `ภาพที่ ${i + 1}`;
    li.appendChild(img);

    const badge = document.createElement('span');
    badge.className = 'frame-badge';
    badge.textContent = `#${i + 1}`;
    li.appendChild(badge);

    const delBtn = document.createElement('button');
    delBtn.className = 'frame-del-btn';
    delBtn.type = 'button';
    delBtn.innerHTML = '&times;';
    delBtn.setAttribute('aria-label', `ลบภาพที่ ${i + 1}`);
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(frame.url);
      state.frames.splice(i, 1);
      renderFilmstrip();
      refreshControls();
    });
    li.appendChild(delBtn);

    // Drag and Drop
    li.addEventListener('dragstart', () => {
      dragSrcIndex = i;
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrcIndex === null || dragSrcIndex === i) return;
      const [moved] = state.frames.splice(dragSrcIndex, 1);
      state.frames.splice(i, 0, moved);
      dragSrcIndex = null;
      renderFilmstrip();
    });

    els.filmstrip.appendChild(li);
  });
}

function clearOutput() {
  const ctx = els.outputCanvas.getContext('2d');
  ctx.clearRect(0, 0, els.outputCanvas.width, els.outputCanvas.height);
  els.outputCanvas.removeAttribute('width');
  els.outputCanvas.removeAttribute('height');
  els.outputPlaceholder.hidden = false;
  els.downloadBtn.hidden = true;
  els.toggleCompareBtn.hidden = true;
  els.resMeta.textContent = 'ความละเอียด: -';
  els.blendMeta.textContent = 'โหมด: -';
  els.matchesCanvas.removeAttribute('width');
  els.matchesCanvas.removeAttribute('height');
  els.matchesPlaceholder.hidden = false;
  els.matchesCountPill.hidden = true;
  els.pairSelect.innerHTML = '<option value="0">ยังไม่มีข้อมูลการจับคู่</option>';
  els.homographyPairSelect.innerHTML = '<option value="0">ยังไม่มีการคำนวณ Homography</option>';
}

// ---------------------------------------------------------------------------
// Tab Switching
// ---------------------------------------------------------------------------

els.tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    els.tabButtons.forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    els.tabPanels.forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const targetId = btn.getAttribute('data-tab');
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) targetPanel.classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Math & Image Helpers
// ---------------------------------------------------------------------------

const MAX_DIM = 1600;

function loadMat(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve({ mat: cv.imread(off), rawCanvas: off, width: w, height: h });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('ไม่สามารถโหลดรูปภาพได้'));
    img.src = url;
  });
}

function applyHomography(Hd, x, y) {
  const X = Hd[0] * x + Hd[1] * y + Hd[2];
  const Y = Hd[3] * x + Hd[4] * y + Hd[5];
  const W = Hd[6] * x + Hd[7] * y + Hd[8];
  return [X / W, Y / W];
}

function multiply3x3(A, B) {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += A[r * 3 + k] * B[k * 3 + c];
      out[r * 3 + c] = sum;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feature Matches Visualizer (Side-by-Side Canvas)
// ---------------------------------------------------------------------------

function renderSideBySideMatches(canvasA, canvasB, goodQ, goodT, inlierMask, nameA, nameB) {
  const targetW = 960;
  const scale = targetW / (canvasA.width + canvasB.width);
  const wA = Math.round(canvasA.width * scale);
  const hA = Math.round(canvasA.height * scale);
  const wB = Math.round(canvasB.width * scale);
  const hB = Math.round(canvasB.height * scale);

  const maxH = Math.max(hA, hB);
  const canvas = document.createElement('canvas');
  canvas.width = wA + wB + 24;
  canvas.height = maxH + 46;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080b11';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw input images
  ctx.drawImage(canvasA, 0, 34, wA, hA);
  ctx.drawImage(canvasB, wA + 24, 34, wB, hB);

  // Headers
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px "IBM Plex Mono", monospace';
  ctx.fillText(nameA, 8, 22);
  ctx.fillText(nameB, wA + 30, 22);

  const numMatches = goodQ.length / 2;
  const bOffsetX = wA + 24;

  // Draw inliers (emerald lines + glowing keypoints)
  let inlierCount = 0;
  for (let i = 0; i < numMatches; i++) {
    if (inlierMask[i]) {
      inlierCount++;
      const xB = goodQ[i * 2] * scale + bOffsetX;
      const yB = goodQ[i * 2 + 1] * scale + 34;
      const xA = goodT[i * 2] * scale;
      const yA = goodT[i * 2 + 1] * scale + 34;

      // Connecting line
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(xA, yA);
      ctx.lineTo(xB, yB);
      ctx.stroke();

      // Keypoints
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(xA, yA, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(xB, yB, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { canvas, inlierCount, totalMatches: numMatches };
}

// ---------------------------------------------------------------------------
// Auto-Crop Black Borders
// ---------------------------------------------------------------------------

function autoCropMat(mat) {
  const w = mat.cols;
  const h = mat.rows;
  const data = mat.data;

  let minY = 0, maxY = h - 1;
  let minX = 0, maxX = w - 1;

  for (let y = 0; y < h; y++) {
    let hasContent = false;
    for (let x = 0; x < w; x += 10) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        hasContent = true;
        break;
      }
    }
    if (hasContent) {
      minY = y;
      break;
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    let hasContent = false;
    for (let x = 0; x < w; x += 10) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        hasContent = true;
        break;
      }
    }
    if (hasContent) {
      maxY = y;
      break;
    }
  }

  for (let x = 0; x < w; x++) {
    let hasContent = false;
    for (let y = minY; y <= maxY; y += 10) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        hasContent = true;
        break;
      }
    }
    if (hasContent) {
      minX = x;
      break;
    }
  }

  for (let x = w - 1; x >= 0; x--) {
    let hasContent = false;
    for (let y = minY; y <= maxY; y += 10) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        hasContent = true;
        break;
      }
    }
    if (hasContent) {
      maxX = x;
      break;
    }
  }

  const padX = Math.round((maxX - minX) * 0.015);
  const padY = Math.round((maxY - minY) * 0.015);
  const cropX = Math.max(0, minX + padX);
  const cropY = Math.max(0, minY + padY);
  const cropW = Math.max(10, maxX - minX - padX * 2);
  const cropH = Math.max(10, maxY - minY - padY * 2);

  const roi = mat.roi(new cv.Rect(cropX, cropY, cropW, cropH));
  const cropped = new cv.Mat();
  roi.copyTo(cropped);
  roi.delete();
  return cropped;
}

// ---------------------------------------------------------------------------
// Core Pipeline: Global Homographies & Multi-Image Seamless Blending
// ---------------------------------------------------------------------------

async function stitchAll() {
  if (!cvReady || state.frames.length < 2 || state.isProcessing) return;

  state.isProcessing = true;
  state.pairsData = [];
  if (state.currentResultMat) {
    try { state.currentResultMat.delete(); } catch (_) {}
    state.currentResultMat = null;
  }
  if (state.hardCutMat) {
    try { state.hardCutMat.delete(); } catch (_) {}
    state.hardCutMat = null;
  }

  refreshControls();
  els.downloadBtn.hidden = true;
  els.toggleCompareBtn.hidden = true;
  els.execMetricsBadge.hidden = true;

  const tStart = performance.now();
  setProcessStatus('กำลังเตรียมภาพและตรวจจับจุดเด่น (ORB)...');
  await tick();

  let loadedImages = [];
  try {
    loadedImages = await Promise.all(state.frames.map((f) => loadMat(f.url)));
  } catch (err) {
    setProcessStatus(`โหลดรูปภาพไม่สำเร็จ: ${err.message}`, true);
    state.isProcessing = false;
    refreshControls();
    return;
  }

  const options = {
    blendMode: els.blendModeSelect.value,
    maxFeatures: parseInt(els.maxFeaturesSelect.value || '4000', 10),
    ransacThresh: parseFloat(els.ransacThreshSelect.value || '5.0'),
    autoCrop: els.autoCropCheckbox.checked,
  };

  const cleanupMats = [];
  const track = (m) => { cleanupMats.push(m); return m; };

  try {
    // 1. Detect & Compute ORB Features for each image
    const kps = [];
    const descs = [];

    for (let i = 0; i < loadedImages.length; i++) {
      setProcessStatus(`ตรวจจับจุดเด่นภาพที่ ${i + 1}/${loadedImages.length} (ORB)...`);
      await tick();

      const gray = track(new cv.Mat());
      cv.cvtColor(loadedImages[i].mat, gray, cv.COLOR_RGBA2GRAY);

      const orb = new cv.ORB(options.maxFeatures);
      const kp = new cv.KeyPointVector();
      const des = track(new cv.Mat());
      const emptyMask = track(new cv.Mat());

      orb.detectAndCompute(gray, emptyMask, kp, des);
      orb.delete();

      if (des.rows < 8) {
        kp.delete();
        throw new Error(`ภาพที่ ${i + 1} (${state.frames[i].name}) มีจุดเด่นน้อยเกินไป`);
      }

      kps.push(kp);
      descs.push(des);
    }

    // 2. Compute Homography between each adjacent pair (i+1 to i)
    // H_pair[i] maps points in Image i+1 to Image i
    const pairHs = [];
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);

    for (let i = 0; i < loadedImages.length - 1; i++) {
      setProcessStatus(
        `จับคู่จุดเด่นและคำนวณ Homography: ภาพที่ ${i + 1} ↔ ${i + 2}...`
      );
      await tick();

      const desDst = descs[i];     // Image i (Left / Train)
      const desSrc = descs[i + 1]; // Image i+1 (Right / Query)

      const knn = new cv.DMatchVectorVector();
      bf.knnMatch(desSrc, desDst, knn, 2);

      const goodQ = []; // points in src (Image i+1)
      const goodT = []; // points in dst (Image i)

      for (let j = 0; j < knn.size(); j++) {
        const pair = knn.get(j);
        if (pair.size() < 2) continue;
        const m0 = pair.get(0);
        const m1 = pair.get(1);
        if (m0.distance < 0.75 * m1.distance) {
          const pSrc = kps[i + 1].get(m0.queryIdx).pt;
          const pDst = kps[i].get(m0.trainIdx).pt;
          goodQ.push(pSrc.x, pSrc.y);
          goodT.push(pDst.x, pDst.y);
        }
      }
      knn.delete();

      const numGood = goodQ.length / 2;
      if (numGood < 8) {
        throw new Error(
          `คู่ภาพที่ ${i + 1} และ ${i + 2} มีจุดเด่นร่วมกันไม่พอ (${numGood} จุด) ตรวจสอบการซ้อนทับของภาพ`
        );
      }

      const srcMat = track(cv.matFromArray(numGood, 1, cv.CV_32FC2, goodQ));
      const dstMat = track(cv.matFromArray(numGood, 1, cv.CV_32FC2, goodT));
      const mask = track(new cv.Mat());
      const H = track(cv.findHomography(srcMat, dstMat, cv.RANSAC, options.ransacThresh, mask));

      if (H.empty()) {
        throw new Error(`ไม่สามารถคำนวณ Homography ระหว่างภาพที่ ${i + 1} และ ${i + 2} ได้`);
      }

      const inlierMaskArray = [];
      let inliers = 0;
      for (let m = 0; m < mask.rows; m++) {
        const isInlier = mask.data[m] !== 0;
        inlierMaskArray.push(isInlier);
        if (isInlier) inliers++;
      }

      if (inliers < 8) {
        throw new Error(`Inliers ไม่พอ (${inliers} จุด) ระหว่างภาพที่ ${i + 1} และ ${i + 2}`);
      }

      const Hd = Array.from(H.data64F);
      pairHs.push(Hd);

      // Render side-by-side visualization
      const matchVis = renderSideBySideMatches(
        loadedImages[i].rawCanvas,
        loadedImages[i + 1].rawCanvas,
        goodQ,
        goodT,
        inlierMaskArray,
        state.frames[i].name || `ภาพที่ ${i + 1}`,
        state.frames[i + 1].name || `ภาพที่ ${i + 2}`
      );

      state.pairsData.push({
        pairIndex: i,
        nameA: state.frames[i].name || `ภาพที่ ${i + 1}`,
        nameB: state.frames[i + 1].name || `ภาพที่ ${i + 2}`,
        totalMatches: numGood,
        inliers,
        inlierRatio: ((inliers / numGood) * 100).toFixed(1),
        H: Hd,
        matchCanvas: matchVis.canvas,
      });
    }

    bf.delete();
    kps.forEach((kp) => kp.delete());

    // 3. Compute Cumulative Homographies to Image 0 Coordinate System
    // H_to_0[0] = I
    // H_to_0[1] = H_pair[0]
    // H_to_0[2] = H_pair[0] * H_pair[1] ...
    const H_to_0 = [[1, 0, 0, 0, 1, 0, 0, 0, 1]];
    for (let i = 0; i < pairHs.length; i++) {
      const prevH = H_to_0[H_to_0.length - 1];
      const nextH = multiply3x3(prevH, pairHs[i]);
      H_to_0.push(nextH);
    }

    // 4. Find Global Canvas Bounding Box
    let minX = 0, minY = 0;
    let maxX = loadedImages[0].width, maxY = loadedImages[0].height;

    for (let i = 0; i < loadedImages.length; i++) {
      const w = loadedImages[i].width;
      const h = loadedImages[i].height;
      const corners = [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ].map(([x, y]) => applyHomography(H_to_0[i], x, y));

      corners.forEach(([x, y]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
    }

    minX = Math.floor(minX);
    minY = Math.floor(minY);
    maxX = Math.ceil(maxX);
    maxY = Math.ceil(maxY);

    const tx = -minX;
    const ty = -minY;
    const outW = maxX - minX;
    const outH = maxY - minY;

    if (outW <= 0 || outH <= 0 || outW > 12000 || outH > 12000) {
      throw new Error(`ขนาด Canvas ผิดปกติ (${outW}x${outH}) เกิดจากค่า Homography เบี่ยงเบนสูง`);
    }

    setProcessStatus(`ขนาดพาโนรามา: ${outW} × ${outH} px — กำลังทำ Perspective Warping...`);
    await tick();

    // 5. Warp Each Image to Global Canvas & Calculate Distance Maps
    const T = [1, 0, tx, 0, 1, ty, 0, 0, 1];
    const warpedMats = [];
    const distMats = [];

    for (let i = 0; i < loadedImages.length; i++) {
      const Mi = multiply3x3(T, H_to_0[i]);
      const MMat = track(cv.matFromArray(3, 3, cv.CV_64F, Mi));
      const warped = track(new cv.Mat());
      cv.warpPerspective(loadedImages[i].mat, warped, MMat, new cv.Size(outW, outH));
      warpedMats.push(warped);

      // Distance Transform for Seamless Blending
      const mask = track(new cv.Mat(outH, outW, cv.CV_8UC1, new cv.Scalar(0)));
      const mData = mask.data;
      const wData = warped.data;
      const totalPx = outW * outH;

      for (let p = 0; p < totalPx; p++) {
        if (wData[p * 4 + 3] > 10) mData[p] = 255;
      }

      const dist = track(new cv.Mat());
      cv.distanceTransform(mask, dist, cv.DIST_L2, 3);
      distMats.push(dist);
    }

    // 6. Blending Output Execution
    setProcessStatus('กำลังผสมภาพอย่างไร้รอยต่อ (Seamless Distance Transform Blending)...');
    await tick();

    const blendedMat = new cv.Mat(outH, outW, cv.CV_8UC4, new cv.Scalar(0, 0, 0, 0));
    const hardMat = new cv.Mat(outH, outW, cv.CV_8UC4, new cv.Scalar(0, 0, 0, 0));
    const outData = blendedMat.data;
    const hardData = hardMat.data;
    const totalPx = outW * outH;

    const numImgs = loadedImages.length;
    const distPtrs = distMats.map((d) => d.data32F);
    const warpedDatas = warpedMats.map((w) => w.data);

    const isSeamless = options.blendMode === 'distance_transform';
    const isLinear = options.blendMode === 'linear_feather';

    for (let p = 0; p < totalPx; p++) {
      let sumDist = 0;
      let maxDist = 0;
      let bestIdx = -1;
      const idx = p * 4;

      for (let i = 0; i < numImgs; i++) {
        const d = distPtrs[i][p];
        if (d > 0) {
          sumDist += d;
          if (d > maxDist) {
            maxDist = d;
            bestIdx = i;
          }
        }
      }

      // Hard Cut / Voronoi Overwrite (for live comparison toggle)
      if (bestIdx >= 0) {
        const bData = warpedDatas[bestIdx];
        hardData[idx] = bData[idx];
        hardData[idx + 1] = bData[idx + 1];
        hardData[idx + 2] = bData[idx + 2];
        hardData[idx + 3] = 255;
      }

      // Output Blending
      if (sumDist > 0) {
        if (isSeamless) {
          // Distance Transform Weighted Seamless Blending
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < numImgs; i++) {
            const d = distPtrs[i][p];
            if (d > 0) {
              const weight = d / sumDist;
              const wData = warpedDatas[i];
              r += wData[idx] * weight;
              g += wData[idx + 1] * weight;
              b += wData[idx + 2] * weight;
            }
          }
          outData[idx] = Math.round(r);
          outData[idx + 1] = Math.round(g);
          outData[idx + 2] = Math.round(b);
          outData[idx + 3] = 255;
        } else if (isLinear) {
          // Linear / Soft overlap
          let r = 0, g = 0, b = 0;
          let count = 0;
          for (let i = 0; i < numImgs; i++) {
            if (distPtrs[i][p] > 0) {
              count++;
              const wData = warpedDatas[i];
              r += wData[idx];
              g += wData[idx + 1];
              b += wData[idx + 2];
            }
          }
          outData[idx] = Math.round(r / count);
          outData[idx + 1] = Math.round(g / count);
          outData[idx + 2] = Math.round(b / count);
          outData[idx + 3] = 255;
        } else {
          // No blending (hard seam)
          outData[idx] = hardData[idx];
          outData[idx + 1] = hardData[idx + 1];
          outData[idx + 2] = hardData[idx + 2];
          outData[idx + 3] = hardData[idx + 3];
        }
      }
    }

    let finalMat = blendedMat;

    // 7. Auto-Crop Black Borders if enabled
    if (options.autoCrop) {
      setProcessStatus('กำลังตัดขอบดำรอบนอก (Auto-Cropping)...');
      await tick();
      const cropped = autoCropMat(finalMat);
      finalMat.delete();
      finalMat = cropped;

      const croppedHard = autoCropMat(hardMat);
      hardMat.delete();
      state.hardCutMat = croppedHard;
    } else {
      state.hardCutMat = hardMat;
    }

    state.currentResultMat = finalMat;

    // Render Final Panorama
    cv.imshow('outputCanvas', finalMat);
    els.outputPlaceholder.hidden = true;

    state.blendedDataUrl = els.outputCanvas.toDataURL('image/png');
    els.downloadBtn.href = state.blendedDataUrl;
    els.downloadBtn.hidden = false;

    // Metadata & Badges
    const elapsedSec = ((performance.now() - tStart) / 1000).toFixed(2);
    els.resMeta.textContent = `ความละเอียด: ${finalMat.cols} × ${finalMat.rows} px`;
    els.blendMeta.textContent = `โหมด: ${
      options.blendMode === 'distance_transform'
        ? 'Seamless (Distance Transform)'
        : options.blendMode === 'linear_feather'
        ? 'Linear Feather'
        : 'No Blending'
    }`;
    els.execMetricsBadge.textContent = `⏱ ${elapsedSec}s`;
    els.execMetricsBadge.hidden = false;
    els.toggleCompareBtn.hidden = false;

    // Populate Visualizer Tabs
    populatePairSelectors();
    renderActivePairVisuals(0);

    setProcessStatus(`ประกบภาพพาโนรามาสำเร็จ (${state.frames.length} ภาพ ในเวลา ${elapsedSec} วินาที)!`);
  } catch (err) {
    console.error(err);
    setProcessStatus(err.message || 'เกิดข้อผิดพลาดระหว่างการประมวลผล', true);
  } finally {
    // Cleanup temporary mats
    cleanupMats.forEach((m) => {
      try { m.delete(); } catch (_) {}
    });
    loadedImages.forEach((img) => {
      try { img.mat.delete(); } catch (_) {}
    });
    state.isProcessing = false;
    refreshControls();
  }
}

els.stitchBtn.addEventListener('click', stitchAll);

// ---------------------------------------------------------------------------
// Pair Visualizer & Homography Inspector
// ---------------------------------------------------------------------------

function populatePairSelectors() {
  if (!state.pairsData.length) return;

  let optionsHtml = '';
  state.pairsData.forEach((p, idx) => {
    optionsHtml += `<option value="${idx}">คู่ที่ ${idx + 1}: ${p.nameA} ↔ ${p.nameB}</option>`;
  });

  els.pairSelect.innerHTML = optionsHtml;
  els.homographyPairSelect.innerHTML = optionsHtml;
  els.matchesCountPill.textContent = `${state.pairsData.length} คู่`;
  els.matchesCountPill.hidden = false;
}

function renderActivePairVisuals(pairIdx) {
  const p = state.pairsData[pairIdx];
  if (!p) return;

  // Render Matches Canvas
  const mCtx = els.matchesCanvas.getContext('2d');
  els.matchesCanvas.width = p.matchCanvas.width;
  els.matchesCanvas.height = p.matchCanvas.height;
  mCtx.drawImage(p.matchCanvas, 0, 0);
  els.matchesPlaceholder.hidden = true;

  // Render Stats
  els.statTotalMatches.textContent = p.totalMatches;
  els.statInliers.textContent = p.inliers;
  els.statInlierRatio.textContent = `${p.inlierRatio}%`;

  // Render Homography Grid
  const H = p.H;
  const cells = els.matrixValuesGrid.querySelectorAll('.m-cell');
  if (cells.length === 9) {
    for (let i = 0; i < 9; i++) {
      cells[i].textContent = H[i].toFixed(4);
    }
  }

  // Geometric interpretations
  const dx = H[2].toFixed(1);
  const dy = H[5].toFixed(1);
  els.transVal.textContent = `dx: ${dx} px, dy: ${dy} px`;

  const sx = Math.sqrt(H[0] * H[0] + H[1] * H[1]).toFixed(3);
  const sy = Math.sqrt(H[3] * H[3] + H[4] * H[4]).toFixed(3);
  els.scaleVal.textContent = `sx: ${sx}, sy: ${sy}`;

  const h31 = H[6].toFixed(5);
  const h32 = H[7].toFixed(5);
  els.projVal.textContent = `${h31}, ${h32}`;
}

els.pairSelect.addEventListener('change', (e) => {
  const idx = parseInt(e.target.value, 10);
  renderActivePairVisuals(idx);
  els.homographyPairSelect.value = e.target.value;
});

els.homographyPairSelect.addEventListener('change', (e) => {
  const idx = parseInt(e.target.value, 10);
  renderActivePairVisuals(idx);
  els.pairSelect.value = e.target.value;
});

// ---------------------------------------------------------------------------
// Hold-to-Compare Toggle (Seamless vs No-Blending)
// ---------------------------------------------------------------------------

let isHoldingCompare = false;

function showUnblendedCompare() {
  if (!state.hardCutMat) return;
  isHoldingCompare = true;
  els.toggleCompareBtn.style.background = 'rgba(239, 68, 68, 0.2)';
  els.toggleCompareBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
  cv.imshow('outputCanvas', state.hardCutMat);
  els.blendMeta.textContent = 'โหมด: No Blending (Hard Seam - รอยต่อคมชัด)';
}

function restoreBlended() {
  if (!isHoldingCompare || !state.currentResultMat) return;
  isHoldingCompare = false;
  els.toggleCompareBtn.style.background = '';
  els.toggleCompareBtn.style.borderColor = '';
  cv.imshow('outputCanvas', state.currentResultMat);
  els.blendMeta.textContent = `โหมด: ${
    els.blendModeSelect.value === 'distance_transform'
      ? 'Seamless (Distance Transform)'
      : els.blendModeSelect.value === 'linear_feather'
      ? 'Linear Feather'
      : 'No Blending'
  }`;
}

els.toggleCompareBtn.addEventListener('mousedown', showUnblendedCompare);
els.toggleCompareBtn.addEventListener('mouseup', restoreBlended);
els.toggleCompareBtn.addEventListener('mouseleave', restoreBlended);
els.toggleCompareBtn.addEventListener('touchstart', (e) => { e.preventDefault(); showUnblendedCompare(); });
els.toggleCompareBtn.addEventListener('touchend', restoreBlended);

// Fullscreen
els.fullscreenBtn.addEventListener('click', () => {
  if (els.outputCanvas.requestFullscreen) {
    els.outputCanvas.requestFullscreen();
  }
});

// ---------------------------------------------------------------------------
// Initial Setup
// ---------------------------------------------------------------------------

renderFilmstrip();
refreshControls();
setProcessStatus('กำลังโหลด OpenCV.js (WebAssembly)...');
