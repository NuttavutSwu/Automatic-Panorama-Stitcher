# Automatic Panorama Stitcher 🌄

โปรเจกต์ Computer Vision สำหรับต่อภาพพาโนรามาอัตโนมัติ (Automatic Image Stitching) แบบครบวงจร:
- **Multi-image Feature Matching** (ORB + BFMatcher + Lowe's Ratio Test)
- **Homography Warping** (RANSAC Outlier Rejection + Perspective Transform)
- **Seamless Feathering Blending** (Distance-Transform Weighted Blending)
- **Auto-Crop** (ระบบตัดขอบดำจากการวาร์ปมุมมองอัตโนมัติ)
- **Inlier Matches Visualizer** (แสดงเส้นจับคู่จุดเด่นสำหรับการศึกษาและพรีเซนต์)

ประมวลผลทั้งหมดบนเบราว์เซอร์ 100% ด้วย [OpenCV.js](https://docs.opencv.org/4.9.0/opencv.js) (WebAssembly) ไม่ต้องติดตั้ง Backend และไม่ต้องอัปโหลดภาพขึ้นเซิร์ฟเวอร์ภายนอก

---

## ✨ ฟีเจอร์เด่น (Features)

1. **Seamless Blending**: ลบรอยตะเข็บรอยต่อ (Hard Seam) ด้วยการเกลี่ยน้ำหนักตามระยะห่างขอบภาพ (Distance Transform Feathering) ผสมสีและแสงในบริเวณทับซ้อน (Overlap) ได้อย่างกลมกลืน
2. **Auto-Crop Black Borders**: ตรวจจับและตัดขอบดำที่เกิดจากการเอียงระนาบของ Homography ออกให้อัตโนมัติ ได้ภาพสี่เหลี่ยมผืนผ้าที่สวยงาม
3. **Interactive Feature Matches Viewer**: กดปุ่มดูเส้นโยงคู่จุดเด่น (Keypoints & Inlier Matches) ที่ผ่านการคัดกรองด้วย RANSAC
4. **1-Click Sample Testing**: มีปุ่มโหลดภาพตัวอย่าง (`1.jpg`, `2.jpg`, `3.jpg`) ในตัว ทดสอบรันได้ทันทีในคลิกเดียว
5. **Drag-and-Drop & Reorder**: ลากสลับตำแหน่งภาพในแถบฟิล์มได้อย่างอิสระ
6. **Progress Indicator**: แสดงสถานะและเปอร์เซ็นต์ความคืบหน้าของแต่ละสเต็ปอย่างละเอียด

---

## 🔬 ทฤษฎีและอัลกอริทึม Computer Vision

การทำงานของระบบแบ่งเป็น 4 สเต็ปหลัก:

### 1. Feature Detection & Description (ORB)
- ใช้อัลกอริทึม **ORB (Oriented FAST and Rotated BRIEF)** ตรวจจับ 4,000 จุดเด่นในแต่ละภาพ
- จุดเด่นของ ORB คือรวดเร็วมาก ทนทานต่อการหมุน (Rotation Invariance) และการเปลี่ยนแปลงความสว่าง (Illumination Robustness)

### 2. Feature Matching (Hamming Distance + Lowe's Ratio Test)
- ใช้ **Brute-Force Matcher** จับคู่ Descriptor แบบ Binary ด้วย Hamming Distance
- กรองคู่จุดที่คลุมเครือด้วย **Lowe's Ratio Test ($0.75$)** โดยยอมรับคู่จุดก็ต่อเมื่อระยะห่างของจุดที่ใกล้ที่สุด ($d_1$) น้อยกว่า $0.75 \times d_2$ (จุดที่ใกล้เป็นอันดับสอง)

### 3. Homography Estimation with RANSAC
- นำคู่จุดที่ผ่านการกรองมาคำนวณเมทริกซ์การแปลงมุมมอง $3 \times 3$ (**Homography Matrix, $H$**)
- ใช้อัลกอริทึม **RANSAC (Random Sample Consensus)** ตัดจุดที่เป็น Outlier (เช่น วัตถุที่ขยับ หรือจุดที่แมตช์ผิดพลาด) ออกอย่างแม่นยำ

### 4. Perspective Warping & Seamless Blending
- คำนวณขอบเขต Global Canvas ที่รวมทุกภาพเข้าด้วยกัน
- วาร์ปภาพเข้าสู่พิกัดเดียวกันด้วย `cv.warpPerspective`
- ในบริเวณที่มีภาพทับซ้อนกัน (Overlap Zone) ระบบจะคำนวณน้ำหนักระยะห่างจากขอบ $d_A$ และ $d_B$:
  $$w_A = \frac{d_A}{d_A + d_B}, \quad w_B = \frac{d_B}{d_A + d_B}$$
  แล้วทำ Smoothstep S-curve ($S(t) = 3t^2 - 2t^3$) เพื่อให้การเชื่อมรอยต่อเรียบเนียนที่สุด

---

## 🚀 วิธีเปิดรันในเครื่อง (Local Run)

เนื่องจากเบราว์เซอร์บางตัวบล็อก CORS เมื่อเปิดผ่าน `file://` โดยตรง แนะนำให้เปิดผ่าน Local HTTP Server:

```bash
# ใช้ Python 3
python -m http.server 8000
```

จากนั้นเปิดเบราว์เซอร์ไปที่: `http://localhost:8000`

---

## 🌐 วิธี Deploy ขึ้นเว็บให้ทุกคนใช้งานได้ (GitHub Pages)

เนื่องจากโปรเจกต์นี้เป็น Pure Client-side Web (HTML/CSS/JS + OpenCV.js CDN) จึงสามารถเปิดใช้งานออนไลน์ได้ฟรีบน **GitHub Pages** ใน 3 ขั้นตอน:

1. Push โค้ดทั้งหมดขึ้น GitHub:
   ```bash
   git add .
   git commit -m "feat: Add seamless blending, auto-crop, sample loader, and match viewer"
   git push origin Poom
   ```
2. ไปที่หน้า GitHub Repository:
   - คลิกแท็บ **Settings** ด้านบน
   - ที่เมนูด้านซ้าย เลือก **Pages**
3. ตั้งค่าการ Deploy:
   - ในส่วน **Build and deployment > Source**: เลือก `Deploy from a branch`
   - ในส่วน **Branch**: เลือก branch ที่มีโค้ด (เช่น `Poom` หรือ `main`) และเลือกโฟลเดอร์ `/ (root)`
   - กดปุ่ม **Save**

รอประมาณ 1–2 นาที GitHub จะสร้าง URL สำหรับเปิดใช้งาน เช่น:
`https://thanapoomduangmak-swu.github.io/Automatic-Panorama-Stitcher/`
สามารถส่งลิงก์นี้ให้ผู้อื่นทดลองใช้งานบนคอมพิวเตอร์หรือมือถือได้ทันที!

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
Automatic-Panorama-Stitcher/
├── index.html       # โครงสร้างหน้าเว็บ แถบควบคุม Modal และ Pipeline cards
├── style.css        # ดีไซน์ Dark Tech ทันสมัย, Progress bar, Glassmorphism
├── app.js           # โลจิก OpenCV.js, ORB, RANSAC, Blending, Auto-crop
├── 1.jpg, 2.jpg, 3.jpg # รูปภาพตัวอย่างสำหรับทดสอบต่อพาโนรามา
└── README.md        # คู่มือการใช้งานและทฤษฎี Computer Vision
```
