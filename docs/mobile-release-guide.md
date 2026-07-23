# PL CHAT Mobile Download Guide

PL CHAT รองรับมือถือทุกยี่ห้อด้วย 4 ช่องทางหลัก

## 1. Android APK สำหรับทดลองติดตั้งตรง

ใช้สำหรับ Samsung, Xiaomi, OPPO, vivo, realme, OnePlus, Motorola, Sony, Huawei และ Android รุ่นอื่นๆ ที่อนุญาตติดตั้ง APK จากไฟล์

```bash
npm install
npm install -g eas-cli
eas login
eas build --profile preview --platform android
```

ไฟล์ที่ได้จาก EAS จะเป็น `.apk` ตามค่าใน `eas.json` profile `preview` สามารถส่งลิงก์ให้ผู้ใช้ทดสอบดาวน์โหลดได้

## 2. Android AAB สำหรับ Google Play

ใช้เมื่อต้องปล่อยจริงบน Google Play Store

```bash
eas build --profile production --platform android
```

ไฟล์ production จะเป็น `.aab` เพื่อส่งขึ้น Play Console

## 3. iPhone ผ่าน TestFlight หรือ App Store

iPhone ไม่สามารถติดตั้ง APK ได้ ต้องใช้ TestFlight, App Store หรือบัญชี Apple Developer สำหรับการทดสอบแบบ internal/ad hoc

```bash
eas build --profile production --platform ios
```

หลัง build สำเร็จ ให้ submit ผ่าน App Store Connect หรือใช้ TestFlight สำหรับทีมทดสอบ

## 4. PWA สำหรับมือถือทุกยี่ห้อ

โฟลเดอร์ `preview-desktop` ถูกเพิ่ม `manifest.webmanifest` และ `sw.js` แล้ว เมื่อนำโฟลเดอร์นี้ขึ้น HTTPS hosting ผู้ใช้ Android และ iPhone สามารถเปิดผ่านเบราว์เซอร์และเลือก Add to Home Screen ได้

คำแนะนำสำหรับ production:

- โฮสต์ผ่าน HTTPS เท่านั้น
- ตั้ง Cloudflare / CDN ด้านหน้า
- ใช้ domain จริง เช่น `https://plchat.app`
- ต่อ API production แทน mock data
- เปิด push notification ผ่าน FCM/APNs ใน native app

## สถานะเครื่องนี้

เครื่องปัจจุบันยัง build APK/IPA ไม่ได้ เพราะ `node.exe` ถูกบล็อกและไม่มี `npm/npx` ใน PATH ต้องติดตั้งหรือปลดบล็อก Node.js ก่อน จากนั้นรันคำสั่งด้านบนเพื่อออกไฟล์ดาวน์โหลดจริง
