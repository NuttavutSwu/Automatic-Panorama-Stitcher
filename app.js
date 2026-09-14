// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cvReady = false;
let dragSrcIndex = null;

const state = {
  // Array of { id, file, url }
  frames: [],
  // Last cv.Mat of feature matches visualization
  lastMatchesMat: null,
  matchesInfoText: '',
};

const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  browseBtn: document.getElementById('browseBtn'),
  sampleBtn: document.getElementById('sampleBtn'),
  filmstrip: document.getElementById('filmstrip'),
  stitchBtn: document.getElementById('stitchBtn'),
  resetBtn: document.getElementById('resetBtn'),
  viewMatchesBtn: document.getElementById('viewMatchesBtn'),
  downloadLink: document.getElementById('downloadLink'),
  blendingToggle: document.getElementById('blendingToggle'),
  cropToggle: document.getElementById('cropToggle'),
  status: document.getElementById('status'),
  progressWrap: document.getElementById('progressWrap'),
  progressPercent: document.getElementById('progressPercent'),
  progressBarFill: document.getElementById('progressBarFill'),
  canvas: document.getElementById('outputCanvas'),
  placeholder: document.getElementById('placeholder'),
  matchesModal: document.getElementById('matchesModal'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  modalMatchesInfo: document.getElementById('modalMatchesInfo'),
  matchesCanvas: document.getElementById('matchesCanvas'),
};

// ---------------------------------------------------------------------------
// OpenCV load handshake (called from index.html once the runtime is ready)
// ---------------------------------------------------------------------------

function onOpenCvReady() {
  cvReady = true;
  const pill = document.getElementById('systemPill');
  const pillText = document.getElementById('pillText');
  if (pill) pill.classList.add('ready');
  if (pillText) pillText.textContent = 'OpenCV พร้อมใช้งาน';
  setStatus(state.frames.length >= 2 ? 'พร้อมประกบภาพ' : 'เพิ่มรูป หรือคลิก "ลองภาพตัวอย่าง"');
  refreshControls();
}

// ---------------------------------------------------------------------------
// Utilities & Progress
// ---------------------------------------------------------------------------

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

function updateProgress(percent, msg, isError = false) {
  els.progressWrap.hidden = false;
  els.progressPercent.textContent = `${Math.round(percent)}%`;
  els.progressBarFill.style.width = `${Math.round(percent)}%`;
  setStatus(msg, isError);
}

function hideProgress() {
  els.progressWrap.hidden = true;
}

function tick() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function refreshControls() {
  const enough = state.frames.length >= 2;
  els.stitchBtn.disabled = !(enough && cvReady);
  els.resetBtn.disabled = state.frames.length === 0;
  if (state.lastMatchesMat && !state.lastMatchesMat.isDeleted()) {
    els.viewMatchesBtn.hidden = false;
  } else {
    els.viewMatchesBtn.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// File intake & Sample loader
// ---------------------------------------------------------------------------

function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  for (const file of files) {
    state.frames.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      url: URL.createObjectURL(file),
    });
  }
  renderFilmstrip();
  refreshControls();
  if (files.length) {
    setStatus(`เพิ่มรูปแล้ว ${files.length} รูป (รวมทั้งหมด ${state.frames.length} รูป)`);
  }
}

els.browseBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});

// Load sample images (1.jpg, 2.jpg, 3.jpg)
async function loadSampleImages() {
  els.sampleBtn.disabled = true;
  updateProgress(15, 'กำลังโหลดรูปตัวอย่าง (1.jpg, 2.jpg, 3.jpg)...');
  try {
    const sampleNames = ['1.jpg', '2.jpg', '3.jpg'];
    const blobs = await Promise.all(
      sampleNames.map(async (name) => {
        const res = await fetch(name);
        if (!res.ok) throw new Error(`ไม่พบไฟล์ ${name}`);
        const blob = await res.blob();
        return new File([blob], name, { type: 'image/jpeg' });
      })
    );

    // Clear existing frames
    state.frames.forEach((f) => URL.revokeObjectURL(f.url));
    state.frames = [];
    addFiles(blobs);
    updateProgress(100, 'โหลดภาพตัวอย่าง 3 ภาพเรียบร้อย พร้อมประกบภาพพาโนรามา!');
    setTimeout(() => hideProgress(), 1500);
  } catch (err) {
    updateProgress(0, `ไม่สามารถโหลดภาพตัวอย่าง: ${err.message}`, true);
  } finally {
    els.sampleBtn.disabled = false;
  }
}

els.sampleBtn.addEventListener('click', loadSampleImages);

['dragenter', 'dragover'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('drag-over');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('drag-over');
  })
);
els.dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

els.resetBtn.addEventListener('click', () => {
  state.frames.forEach((f) => URL.revokeObjectURL(f.url));
  state.frames = [];
  if (state.lastMatchesMat && !state.lastMatchesMat.isDeleted()) {
    state.lastMatchesMat.delete();
    state.lastMatchesMat = null;
  }
  renderFilmstrip();
  refreshControls();
  clearOutput();
  hideProgress();
  setStatus('ล้างข้อมูลเรียบร้อย');
});

// ---------------------------------------------------------------------------
// Filmstrip rendering + drag-to-reorder
// ---------------------------------------------------------------------------

function renderFilmstrip() {
  els.filmstrip.innerHTML = '';
  state.frames.forEach((frame, i) => {
    const li = document.createElement('li');
    li.className = 'frame';
    li.draggable = true;
    li.dataset.index = String(i);

    const img = document.createElement('img');
    img.src = frame.url;
    img.alt = `รูปที่ ${i + 1}`;
    li.appendChild(img);

    const index = document.createElement('span');
    index.className = 'frame-index';
    index.textContent = String(i + 1);
    li.appendChild(index);

    const remove = document.createElement('button');
    remove.className = 'frame-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `ลบรูปที่ ${i + 1}`);
    remove.textContent = '\u00d7';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(frame.url);
      state.frames.splice(i, 1);
      renderFilmstrip();
      refreshControls();
    });
    li.appendChild(remove);

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

// ---------------------------------------------------------------------------
// Output canvas helpers
// ---------------------------------------------------------------------------

function clearOutput() {
  const ctx = els.canvas.getContext('2d');
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  els.canvas.removeAttribute('width');
  els.canvas.removeAttribute('height');
  els.placeholder.hidden = false;
  els.downloadLink.hidden = true;
}

// ---------------------------------------------------------------------------
// Image -> cv.Mat loading (downscaled for speed/memory)
// ---------------------------------------------------------------------------

const MAX_DIM = 1600;

function loadMat(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      off.getContext('2d').drawImage(img, 0, 0, w, h);
      try {
        resolve(cv.imread(off));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('โหลดรูปไม่สำเร็จ'));
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Matrix 3x3 Math & Utilities
// ---------------------------------------------------------------------------

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

function invert3x3(M) {
  const [a, b, c, d, e, f, g, h, i] = M;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1.0 / det;
  return [
    A * invDet,
    (-(b * i - c * h)) * invDet,
    (b * f - c * e) * invDet,
    B * invDet,
    (a * i - c * g) * invDet,
    (-(a * f - c * d)) * invDet,
    C * invDet,
    (-(a * h - b * g)) * invDet,
    (a * e - b * d) * invDet,
  ];
}

// ---------------------------------------------------------------------------
// Core CV: Stitch two Mats (imgB onto imgA's coordinate frame)
// ---------------------------------------------------------------------------

function stitchPair(imgA, imgB, useBlending = true, pairIndex = 1) {
  const cleanup = [];
  const track = (m) => {
    cleanup.push(m);
    return m;
  };

  try {
    const grayA = track(new cv.Mat());
    const grayB = track(new cv.Mat());
    cv.cvtColor(imgA, grayA, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(imgB, grayB, cv.COLOR_RGBA2GRAY);

    // 1. ORB Keypoints & Descriptors
    const orb = new cv.ORB(4000);
    const kpA = new cv.KeyPointVector();
    const kpB = new cv.KeyPointVector();
    const desA = track(new cv.Mat());
    const desB = track(new cv.Mat());
    const emptyMask = track(new cv.Mat());
    orb.detectAndCompute(grayA, emptyMask, kpA, desA);
    orb.detectAndCompute(grayB, emptyMask, kpB, desB);

    if (desA.rows < 8 || desB.rows < 8) {
      orb.delete();
      kpA.delete();
      kpB.delete();
      cleanup.forEach((m) => m.delete());
      return null;
    }

    // 2. BFMatcher + Lowe's Ratio Test (0.75)
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const knn = new cv.DMatchVectorVector();
    bf.knnMatch(desB, desA, knn, 2); // match B (query) against A (train)

    const goodQ = []; // points in B
    const goodT = []; // points in A
    const goodMatchesList = [];

    for (let i = 0; i < knn.size(); i++) {
      const pair = knn.get(i);
      if (pair.size() < 2) continue;
      const m0 = pair.get(0);
      const m1 = pair.get(1);
      if (m0.distance < 0.75 * m1.distance) {
        const pB = kpB.get(m0.queryIdx).pt;
        const pA = kpA.get(m0.trainIdx).pt;
        goodQ.push(pB.x, pB.y);
        goodT.push(pA.x, pA.y);
        goodMatchesList.push(m0);
      }
    }

    const numGood = goodQ.length / 2;
    if (numGood < 8) {
      orb.delete();
      kpA.delete();
      kpB.delete();
      bf.delete();
      knn.delete();
      cleanup.forEach((m) => m.delete());
      return null;
    }

    // 3. Estimate Homography via RANSAC
    const srcMat = track(cv.matFromArray(numGood, 1, cv.CV_32FC2, goodQ));
    const dstMat = track(cv.matFromArray(numGood, 1, cv.CV_32FC2, goodT));
    const mask = track(new cv.Mat());
    const H = track(cv.findHomography(srcMat, dstMat, cv.RANSAC, 4.0, mask));

    if (H.empty()) {
      orb.delete();
      kpA.delete();
      kpB.delete();
      bf.delete();
      knn.delete();
      cleanup.forEach((m) => m.delete());
      return null;
    }

    // Count inliers
    let inliers = 0;
    const inlierMatchesVec = new cv.DMatchVector();
    for (let i = 0; i < mask.rows; i++) {
      if (mask.data[i]) {
        inliers++;
        inlierMatchesVec.push_back(goodMatchesList[i]);
      }
    }

    // Save visualization for feature matches (first pair or high-inlier pair)
    if (!state.lastMatchesMat && inliers >= 8) {
      try {
        const matchesOut = new cv.Mat();
        cv.drawMatches(
          imgB, kpB,
          imgA, kpA,
          inlierMatchesVec,
          matchesOut,
          new cv.Scalar(0, 230, 180, 255), // match line color
          new cv.Scalar(255, 94, 54, 255)  // keypoint color
        );
        state.lastMatchesMat = matchesOut;
        state.matchesInfoText = `ตรวจพบ Inliers ${inliers} จุด (จากทั้งหมด ${numGood} คู่แมตช์) ระหว่างภาพคู่ที่ ${pairIndex} และ ${pairIndex + 1}`;
        els.modalMatchesInfo.textContent = state.matchesInfoText;
      } catch (err) {
        console.warn('Cannot draw matches visualization:', err);
      }
    }

    orb.delete();
    kpA.delete();
    kpB.delete();
    bf.delete();
    knn.delete();
    inlierMatchesVec.delete();

    if (inliers < 8) {
      cleanup.forEach((m) => m.delete());
      return null;
    }

    // 4. Calculate output canvas dimensions
    const Hd = Array.from(H.data64F);
    const corners = [
      [0, 0],
      [imgB.cols, 0],
      [imgB.cols, imgB.rows],
      [0, imgB.rows],
    ].map(([x, y]) => applyHomography(Hd, x, y));

    const allX = [0, imgA.cols, ...corners.map((c) => c[0])];
    const allY = [0, imgA.rows, ...corners.map((c) => c[1])];
    const minX = Math.floor(Math.min(...allX));
    const minY = Math.floor(Math.min(...allY));
    const maxX = Math.ceil(Math.max(...allX));
    const maxY = Math.ceil(Math.max(...allY));

    const tx = -minX;
    const ty = -minY;
    const outW = maxX - minX;
    const outH = maxY - minY;

    if (outW <= 0 || outH <= 0 || outW > 10000 || outH > 10000) {
      cleanup.forEach((m) => m.delete());
      return null;
    }

    const Td = [1, 0, tx, 0, 1, ty, 0, 0, 1];
    const THd = multiply3x3(Td, Hd);
    const TH = track(cv.matFromArray(3, 3, cv.CV_64F, THd));

    // 5. Warp imgB into output space
    const warpedB = track(new cv.Mat());
    cv.warpPerspective(imgB, warpedB, TH, new cv.Size(outW, outH));

    const canvasMat = new cv.Mat(outH, outW, imgA.type(), [0, 0, 0, 0]);

    if (!useBlending) {
      // Direct Overwrite mode (for comparison)
      warpedB.copyTo(canvasMat);
      const roi = canvasMat.roi(new cv.Rect(tx, ty, imgA.cols, imgA.rows));
      imgA.copyTo(roi);
      roi.delete();
    } else {
      // 6. Seamless Feathering Blending (Distance-Transform Weighted Blend)
      warpedB.copyTo(canvasMat);

      const invTHd = invert3x3(THd);
      const wA = imgA.cols;
      const hA = imgA.rows;
      const wB = imgB.cols;
      const hB = imgB.rows;

      const dataA = imgA.data;
      const dataCanvas = canvasMat.data;

      for (let yA = 0; yA < hA; yA++) {
        const yCanvas = ty + yA;
        if (yCanvas < 0 || yCanvas >= outH) continue;

        const rowOffsetA = yA * wA;
        const rowOffsetCanvas = yCanvas * outW;

        for (let xA = 0; xA < wA; xA++) {
          const xCanvas = tx + xA;
          if (xCanvas < 0 || xCanvas >= outW) continue;

          const idxA = (rowOffsetA + xA) * 4;
          const aA = dataA[idxA + 3];
          if (aA === 0) continue; // transparent pixel in A

          const idxC = (rowOffsetCanvas + xCanvas) * 4;
          const aB = dataCanvas[idxC + 3];

          if (aB === 0) {
            // Only image A exists here
            dataCanvas[idxC] = dataA[idxA];
            dataCanvas[idxC + 1] = dataA[idxA + 1];
            dataCanvas[idxC + 2] = dataA[idxA + 2];
            dataCanvas[idxC + 3] = aA;
          } else {
            // Overlap region between A and warped B: Blend!
            // Distance to border in A
            const distAx = Math.min(xA, wA - 1 - xA);
            const distAy = Math.min(yA, hA - 1 - yA);
            const distA = Math.max(0.1, Math.min(distAx, distAy));

            // Distance to border in original B
            let distB = 0.1;
            if (invTHd) {
              const [u, v] = applyHomography(invTHd, xCanvas, yCanvas);
              if (u >= 0 && u < wB && v >= 0 && v < hB) {
                const distBx = Math.min(u, wB - 1 - u);
                const distBy = Math.min(v, hB - 1 - v);
                distB = Math.max(0.1, Math.min(distBx, distBy));
              }
            }

            // Normalised weight with smoothstep
            const t = distB / (distA + distB);
            const wBlendB = t * t * (3 - 2 * t);
            const wBlendA = 1 - wBlendB;

            dataCanvas[idxC] = Math.round(wBlendA * dataA[idxA] + wBlendB * dataCanvas[idxC]);
            dataCanvas[idxC + 1] = Math.round(wBlendA * dataA[idxA + 1] + wBlendB * dataCanvas[idxC + 1]);
            dataCanvas[idxC + 2] = Math.round(wBlendA * dataA[idxA + 2] + wBlendB * dataCanvas[idxC + 2]);
            dataCanvas[idxC + 3] = 255;
          }
        }
      }
    }

    cleanup.forEach((m) => m.delete());
    return canvasMat;
  } catch (err) {
    cleanup.forEach((m) => {
      try {
        m.delete();
      } catch (_) {}
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Auto-crop Black Borders
// ---------------------------------------------------------------------------

function autoCropBlackBorders(srcMat) {
  const w = srcMat.cols;
  const h = srcMat.rows;
  const data = srcMat.data;

  // Function to check if a pixel is non-black
  const isPixelValid = (x, y) => {
    const idx = (y * w + x) * 4;
    return data[idx + 3] > 0 && (data[idx] > 5 || data[idx + 1] > 5 || data[idx + 2] > 5);
  };

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  // Trim top
  while (top < bottom) {
    let invalidCount = 0;
    for (let x = left; x <= right; x += 4) {
      if (!isPixelValid(x, top)) invalidCount++;
    }
    const totalSampled = (right - left) / 4;
    if (invalidCount / totalSampled > 0.03) top++;
    else break;
  }

  // Trim bottom
  while (bottom > top) {
    let invalidCount = 0;
    for (let x = left; x <= right; x += 4) {
      if (!isPixelValid(x, bottom)) invalidCount++;
    }
    const totalSampled = (right - left) / 4;
    if (invalidCount / totalSampled > 0.03) bottom--;
    else break;
  }

  // Trim left
  while (left < right) {
    let invalidCount = 0;
    for (let y = top; y <= bottom; y += 4) {
      if (!isPixelValid(left, y)) invalidCount++;
    }
    const totalSampled = (bottom - top) / 4;
    if (invalidCount / totalSampled > 0.03) left++;
    else break;
  }

  // Trim right
  while (right > left) {
    let invalidCount = 0;
    for (let y = top; y <= bottom; y += 4) {
      if (!isPixelValid(right, y)) invalidCount++;
    }
    const totalSampled = (bottom - top) / 4;
    if (invalidCount / totalSampled > 0.03) right--;
    else break;
  }

  const cropW = right - left + 1;
  const cropH = bottom - top + 1;

  if (cropW > 50 && cropH > 50 && (cropW < w || cropH < h)) {
    const rect = new cv.Rect(left, top, cropW, cropH);
    const cropped = srcMat.roi(rect).clone();
    return cropped;
  }

  return srcMat.clone();
}

// ---------------------------------------------------------------------------
// Orchestration: Stitch All
// ---------------------------------------------------------------------------

async function stitchAll() {
  if (!cvReady || state.frames.length < 2) return;

  els.stitchBtn.disabled = true;
  els.resetBtn.disabled = true;
  els.viewMatchesBtn.hidden = true;
  els.downloadLink.hidden = true;

  if (state.lastMatchesMat && !state.lastMatchesMat.isDeleted()) {
    state.lastMatchesMat.delete();
    state.lastMatchesMat = null;
  }

  updateProgress(10, 'กำลังโหลดและเตรียมสเกลภาพ...');
  await tick();

  let mats = [];
  try {
    mats = await Promise.all(state.frames.map((f) => loadMat(f.url)));
  } catch (err) {
    updateProgress(0, `โหลดรูปไม่สำเร็จ: ${err.message}`, true);
    refreshControls();
    return;
  }

  const useBlending = els.blendingToggle.checked;
  const useCrop = els.cropToggle.checked;

  try {
    let current = mats[0];
    const totalPairs = mats.length - 1;

    for (let i = 1; i < mats.length; i++) {
      const stepPercent = 20 + Math.round(((i - 1) / totalPairs) * 60);
      updateProgress(
        stepPercent,
        `กำลังประกบภาพคู่ที่ ${i}/${totalPairs} (${useBlending ? 'Seamless Blending' : 'Direct Overwrite'})...`
      );
      await tick();

      const next = stitchPair(current, mats[i], useBlending, i);
      current.delete();
      mats[i].delete();

      if (!next) {
        throw new Error(
          `หาจุดเชื่อมระหว่างภาพที่ ${i} และ ${i + 1} ไม่พอ ลองสลับลำดับภาพ หรือใช้รูปที่มีพื้นที่ทับซ้อนกันมากกว่านี้`
        );
      }
      current = next;
    }

    if (useCrop) {
      updateProgress(90, 'กำลังตัดขอบดำ (Auto-Crop)...');
      await tick();
      const cropped = autoCropBlackBorders(current);
      current.delete();
      current = cropped;
    }

    updateProgress(96, 'กำลังวาดภาพบน Canvas...');
    await tick();

    cv.imshow('outputCanvas', current);
    els.placeholder.hidden = true;
    els.downloadLink.href = els.canvas.toDataURL('image/png');
    els.downloadLink.hidden = false;
    current.delete();

    updateProgress(100, 'ประกบภาพพาโนรามาเสร็จสมบูรณ์!');
    if (state.lastMatchesMat && !state.lastMatchesMat.isDeleted()) {
      els.viewMatchesBtn.hidden = false;
    }
  } catch (err) {
    mats.forEach((m) => {
      try {
        if (!m.isDeleted()) m.delete();
      } catch (_) {}
    });
    updateProgress(0, err.message || 'เกิดข้อผิดพลาดระหว่างประมวลผล', true);
  } finally {
    refreshControls();
    els.resetBtn.disabled = state.frames.length === 0;
  }
}

// ---------------------------------------------------------------------------
// Matches Modal View
// ---------------------------------------------------------------------------

els.viewMatchesBtn.addEventListener('click', () => {
  if (state.lastMatchesMat && !state.lastMatchesMat.isDeleted()) {
    cv.imshow('matchesCanvas', state.lastMatchesMat);
    els.matchesModal.hidden = false;
  }
});

els.closeModalBtn.addEventListener('click', () => {
  els.matchesModal.hidden = true;
});

els.modalBackdrop.addEventListener('click', () => {
  els.matchesModal.hidden = true;
});

// Close modal with Escape key
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.matchesModal.hidden) {
    els.matchesModal.hidden = true;
  }
});

// ---------------------------------------------------------------------------
// Event Listeners & Startup
// ---------------------------------------------------------------------------

els.stitchBtn.addEventListener('click', stitchAll);

renderFilmstrip();
refreshControls();
setStatus('กำลังโหลดโมดูล OpenCV.js (WebAssembly)...');
