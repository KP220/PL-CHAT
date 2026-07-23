# PL CHAT Product Plan

PL CHAT คือแอพโซเชียลแชทสาธารณะสำหรับผู้ใช้ทั่วโลก ผสมข้อดีของ LINE, WeChat, Facebook, TikTok และ X เข้าด้วยกัน มีแชทเป็นแกนหลัก มีฟีดโพสต์ คลิปสั้น การแชร์ แปลภาษา ส่งไฟล์ขนาดใหญ่ และ ChatGPT Assistant ในแอพเดียว

## MVP

- สมัครสมาชิกด้วยอีเมลส่วนตัวและยืนยันอีเมลก่อนใช้งาน
- Login ด้วย email/password และเตรียมต่อ social login ในอนาคต
- แชท 1:1, แชทกลุ่ม, แชทชุมชนสาธารณะ และแชทส่วนตัว
- โปรไฟล์สาธารณะให้ผู้ใช้แก้ชื่อ username คำแนะนำตัว ลิงก์ สถานะ รูปโปรไฟล์ และรูปปก
- ตั้งชื่อกลุ่ม แก้ชื่อห้องแชท และจัดการคำอธิบายห้องได้ตามสิทธิ์ของเจ้าของหรือผู้ดูแล
- ส่งข้อความ รูป วิดีโอ ไฟล์ และลิงก์ปลอดภัย
- ส่งไฟล์ขนาดใหญ่ผ่าน cloud storage พร้อม resumable upload, progress, expiry link และ permission
- ฟีดรวมแบบโซเชียล มีโพสต์สั้น คลิปสั้น ไลค์ คอมเมนต์ และแชร์
- แปลข้อความในแชทและโพสต์เป็นภาษาที่ผู้ใช้ตั้งค่าไว้
- ChatGPT Assistant ช่วยสรุปแชท แปลภาษา เขียนโพสต์ คิดไอเดีย วางแผนงาน และช่วยผู้ใช้แต่ละคนแบบส่วนตัว
- แดชบอร์ดมินิมอล มีศูนย์เครื่องมือ เช่น Cloud File, QR, Mini Tools, Translate, Moments และ AI Assistant
- รองรับหลายภาษาแบบ Unicode/UTF-8 และเพิ่ม translation pack ได้
- Desktop app สำหรับ Windows และ macOS รวมถึง iOS, Android และ Web

## Architecture

- Mobile app: Expo / React Native
- Desktop app: Electron wrapper สำหรับ Expo Web build
- Backend API: Node.js, Express, Fastify หรือ NestJS
- AI Assistant: OpenAI Responses API เรียกผ่าน backend เท่านั้น
- Realtime chat: WebSocket, Firebase, Supabase หรือ managed realtime service
- Database: PostgreSQL สำหรับข้อมูลหลัก
- File storage: S3-compatible storage, multipart upload, resumable upload และ signed URL
- CDN: ส่งไฟล์ใหญ่และวิดีโอผ่าน CDN เพื่อลด latency ทั่วโลก
- Push notification: Expo Notifications, FCM และ APNs
- Auth: Email/password, email verification และ optional social login
- I18n: translation pack แยกตาม locale, fallback เป็นภาษาของเครื่องหรือ English และบันทึกไฟล์เป็น UTF-8
- Translation: AI Translation API สำหรับแปลแชท/โพสต์ตามภาษาผู้ใช้ พร้อม cache, privacy filter และ opt-in per conversation
- Email delivery: AWS SES, SendGrid, Postmark หรือ SMTP สำหรับส่งรหัสยืนยัน สมัครสมาชิก และ reset password

## OpenAI Assistant Design

- แอพมือถือและหน้าเว็บเรียก backend route เช่น `/api/assistant/chat`
- Backend โหลด `OPENAI_API_KEY` จาก environment หรือ secret manager
- Backend เรียก OpenAI Responses API ด้วย model ที่ตั้งค่าใน `OPENAI_MODEL`
- แต่ละคำขอแนบ `userId`, ภาษาที่ผู้ใช้ตั้งไว้ และบริบทที่ได้รับอนุญาตเท่านั้น
- ข้อมูลส่วนตัวของผู้ใช้ต้องแยกตามบัญชี ห้ามปนกับผู้ใช้อื่น
- เก็บ memory เฉพาะที่ผู้ใช้ยินยอม เช่น ภาษา ความสนใจ และงานที่ติดตามอยู่
- เพิ่ม rate limit ต่อผู้ใช้และต่อ IP เพื่อควบคุมค่าใช้จ่ายและป้องกัน abuse
- เพิ่ม moderation, audit log และ privacy controls สำหรับคำขอ AI
- รองรับ streaming response ในอนาคตเพื่อให้ผู้ช่วยตอบแบบไหลทันที

## Data Model

- users: public profile, avatar, cover image, username, bio, link, status, language, privacy settings และ role
- follows: ความสัมพันธ์ผู้ติดตาม ผู้ที่ติดตาม และสถานะการมองเห็น
- friendships: ความสัมพันธ์เพื่อน คำขอเป็นเพื่อน และสถานะ block
- email_verifications: รหัสยืนยันอีเมล วันหมดอายุ จำนวนครั้งที่กรอกผิด และสถานะการยืนยัน
- sessions: session ปัจจุบัน refresh token อุปกรณ์ และเวลาหมดอายุ
- conversations: แชทเดี่ยว กลุ่ม ชุมชน และ private chat
- conversation_members: สมาชิก สิทธิ์เจ้าของห้อง ผู้ดูแล และสิทธิ์แก้ไขชื่อห้อง
- messages: ข้อความ สถานะอ่าน ไฟล์แนบ และ metadata สำหรับแปลภาษา
- files: metadata ไฟล์ใหญ่ upload session, storage key, checksum, size, expiry และ permission
- posts: โพสต์สั้นและโพสต์ทั่วไป
- short_videos: คลิปสั้น caption ไฟล์วิดีโอ และสถานะการเผยแพร่
- reactions: reaction ต่อข้อความ โพสต์ หรือคลิป
- comments: ความเห็นใต้โพสต์และคลิปสั้น
- shares: การแชร์โพสต์ คลิปสั้น หรือไฟล์
- assistant_threads: conversation state, previous response id, user consent และภาษาที่ใช้
- assistant_memories: memory ที่ผู้ใช้ยินยอมให้เก็บ แยกตาม user
- reports: รายงานเนื้อหาไม่เหมาะสมสำหรับระบบสาธารณะ
- audit_logs: การกระทำสำคัญสำหรับ security, moderation และ AI usage

## Security

- บังคับยืนยันอีเมลก่อนเปิดใช้งานบัญชีทุกครั้ง
- รหัสยืนยันอีเมลควรหมดอายุภายใน 10-15 นาที และจำกัดจำนวนครั้งที่กรอกผิด
- เก็บรหัสผ่านด้วย Argon2id หรือ bcrypt พร้อม cost ที่เหมาะสม
- ป้องกัน brute force ด้วย rate limit, device fingerprint, IP risk check และ account lock ชั่วคราว
- รองรับ MFA สำหรับบัญชีสำคัญและ creator account
- สแกนไฟล์ใหญ่ก่อนแชร์ ป้องกัน malware และจำกัดชนิดไฟล์เสี่ยง
- ใช้ signed URL และ expiry link สำหรับไฟล์ส่วนตัว
- ไม่เปิดเผย OpenAI API key ใน client-side code
- โปรไฟล์ต้องเคารพ privacy setting เช่น public, friends only, followers only และ hidden fields
- จำกัดบริบทที่ส่งให้ AI ตามสิทธิ์ของผู้ใช้และ privacy setting
- มี content moderation, block/report, privacy controls และ age-safety policy

## Release Path

1. Prototype: ใช้ mock data เพื่อทดสอบ flow หน้าตา และ assistant preview
2. Private beta: ต่อ auth, email delivery, backend, realtime, OpenAI Assistant, file upload และ push notification
3. Public beta: เปิดผู้ใช้จำกัดจำนวน ทดสอบ moderation, storage cost, AI cost และ performance
4. Production: เปิดให้ผู้ใช้ทั่วโลกดาวน์โหลดจาก App Store, Google Play, เว็บไซต์ และไฟล์ติดตั้งเดสก์ท็อป
