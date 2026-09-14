// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cvReady = false;
let dragSrcIndex = null;

const state = {
  // { id, file, url }
  frames: [],
};

const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  browseBtn: document.getElementById('browseBtn'),
  filmstrip: document.getElementById('filmstrip'),
  stitchBtn: document.getElementById('stitchBtn'),
  resetBtn: document.getElementById('resetBtn'),
  downloadLink: document.getElementById('downloadLink'),
  status: document.getElementById('status'),
  canvas: document.getElementById('outputCanvas'),
  placeholder: document.getElementById('placeholder'),
};

// ---------------------------------------------------------------------------
// OpenCV load handshake (called from index.html once the runtime is ready)
// ---------------------------------------------------------------------------

function onOpenCvReady() {
  cvReady = true;
  setStatus(state.frames.length >= 2 ? 'พร้อมประกบภาพ' : 'โหลด OpenCV เสร็จแล้ว เพิ่มรูปได้เลย');
  refreshControls();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

function tick() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function refreshControls() {
  const enough = state.frames.length >= 2;
  els.stitchBtn.disabled = !(enough && cvReady);
  els.resetBtn.disabled = state.frames.length === 0;
}

// ---------------------------------------------------------------------------
// File intake
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
  if (files.length) setStatus(`เพิ่มแล้ว ${files.length} รูป — รวม ${state.frames.length} รูป`);
}

els.browseBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});

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
  renderFilmstrip();
  refreshControls();
  clearOutput();
  setStatus('ล้างแล้ว');
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
    remove.addEventListener('click', () => {
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
// Core CV: stitch two Mats (imgB onto imgA's coordinate frame)
// Returns a new cv.Mat, or null if not enough matching features were found.
// Caller owns imgA/imgB and must delete them; this function deletes its own
// intermediates and returns a fresh Mat the caller now owns.
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

function stitchPair(imgA, imgB) {
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

    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const knn = new cv.DMatchVectorVector();
    bf.knnMatch(desB, desA, knn, 2); // match B (query) against A (train)

    const goodQ = []; // points in B
    const goodT = []; // corresponding points in A
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
      }
    }

    orb.delete();
    kpA.delete();
    kpB.delete();
    bf.delete();
    knn.delete();

    const numGood = goodQ.length / 2;
    if (numGood < 8) {
      cleanup.forEach((m) => m.delete());
      return null;
    }

    const srcMat = track(cv.matFromArray(numGood, 1, cv.CV_32FC2, goodQ));
    const dstMat = track(cv.matFromArray(numGood, 1, cv.CV_32FC2, goodT));
    const mask = track(new cv.Mat());
    const H = track(cv.findHomography(srcMat, dstMat, cv.RANSAC, 5.0, mask));

    if (H.empty()) {
      cleanup.forEach((m) => m.delete());
      return null;
    }

    // Count RANSAC inliers as a sanity check on match quality.
    let inliers = 0;
    for (let i = 0; i < mask.rows; i++) if (mask.data[i]) inliers++;
    if (inliers < 8) {
      cleanup.forEach((m) => m.delete());
      return null;
    }

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

    // Guard against a degenerate homography blowing up the canvas.
    if (outW <= 0 || outH <= 0 || outW > 9000 || outH > 9000) {
      cleanup.forEach((m) => m.delete());
      return null;
    }

    const Td = [1, 0, tx, 0, 1, ty, 0, 0, 1];
    const THd = multiply3x3(Td, Hd);
    const TH = track(cv.matFromArray(3, 3, cv.CV_64F, THd));

    const warpedB = track(new cv.Mat());
    cv.warpPerspective(imgB, warpedB, TH, new cv.Size(outW, outH));

    const canvasMat = new cv.Mat(outH, outW, imgA.type(), [0, 0, 0, 0]);
    warpedB.copyTo(canvasMat);

    const roi = canvasMat.roi(new cv.Rect(tx, ty, imgA.cols, imgA.rows));
    imgA.copyTo(roi);
    roi.delete();

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
// Orchestration
// ---------------------------------------------------------------------------

async function stitchAll() {
  if (!cvReady || state.frames.length < 2) return;

  els.stitchBtn.disabled = true;
  els.resetBtn.disabled = true;
  els.downloadLink.hidden = true;
  setStatus('กำลังโหลดรูป...');
  await tick();

  let mats = [];
  try {
    mats = await Promise.all(state.frames.map((f) => loadMat(f.url)));
  } catch (err) {
    setStatus(`โหลดรูปไม่สำเร็จ: ${err.message}`, true);
    refreshControls();
    return;
  }

  try {
    let current = mats[0];
    for (let i = 1; i < mats.length; i++) {
      setStatus(`กำลังต่อภาพที่ ${i + 1}/${mats.length}...`);
      await tick();

      const next = stitchPair(current, mats[i]);
      current.delete();
      mats[i].delete();

      if (!next) {
        throw new Error(
          `หาจุดเชื่อมระหว่างภาพที่ ${i} และ ${i + 1} ไม่พอ ลองสลับลำดับ หรือใช้ภาพที่ซ้อนทับกันมากกว่านี้`
        );
      }
      current = next;
    }

    cv.imshow('outputCanvas', current);
    els.placeholder.hidden = true;
    els.downloadLink.href = els.canvas.toDataURL('image/png');
    els.downloadLink.hidden = false;
    current.delete();
    setStatus('เสร็จแล้ว');
  } catch (err) {
    mats.forEach((m) => {
      try {
        m.delete();
      } catch (_) {}
    });
    setStatus(err.message || 'เกิดข้อผิดพลาดระหว่างประมวลผล', true);
  } finally {
    refreshControls();
    els.resetBtn.disabled = state.frames.length === 0;
  }
}

els.stitchBtn.addEventListener('click', stitchAll);

// Initial UI state
renderFilmstrip();
refreshControls();
setStatus('กำลังโหลด OpenCV...');
