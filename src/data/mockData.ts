export type Message = {
  id: string;
  sender: string;
  text: string;
  time: string;
  mine?: boolean;
};

export type ChatRoom = {
  id: string;
  name: string;
  scope: string;
  unread: number;
  lastMessage: string;
  lastTime: string;
  tone: 'team' | 'project' | 'announce' | 'private';
  messages: Message[];
};

export type MoodPost = {
  id: string;
  author: string;
  team: string;
  mood: string;
  text: string;
  time: string;
  reactions: number;
  comments: number;
  shares: number;
  kind: 'post' | 'shortVideo';
};

export const rooms: ChatRoom[] = [
  {
    id: 'global',
    name: 'Global Square',
    scope: 'ชุมชนสาธารณะทั่วโลก',
    unread: 4,
    lastMessage: 'ยินดีต้อนรับผู้ใช้จากทุกประเทศ',
    lastTime: '09:45',
    tone: 'announce',
    messages: [
      { id: 'm1', sender: 'Maya', text: 'สวัสดีจากกรุงเทพ วันนี้ใครมีคลิปหรือไฟล์ใหญ่แชร์ได้เลย', time: '09:32' },
      { id: 'm2', sender: 'Leo', text: 'ผมอัปโหลดวิดีโอโปรเจกต์ใหม่ไว้ใน Cloud File แล้ว', time: '09:34' },
      { id: 'm3', sender: 'คุณ', text: 'ดีมาก เดี๋ยวลองเปิดดูและแชร์ต่อให้เพื่อนครับ', time: '09:45', mine: true }
    ]
  },
  {
    id: 'creator',
    name: 'Creator Hub',
    scope: 'ชุมชนครีเอเตอร์สาธารณะ',
    unread: 2,
    lastMessage: 'แชร์คลิปสั้นและไอเดียใหม่',
    lastTime: '10:12',
    tone: 'team',
    messages: [
      { id: 'm4', sender: 'Mina', text: 'วันนี้มีเทรนด์คลิปสั้นใหม่ ใครทำแล้วแชร์เข้าฟีดได้เลย', time: '10:02' },
      { id: 'm5', sender: 'Jay', text: 'ผมทำ template สำหรับตัดต่อไว้แล้ว ส่งเป็นไฟล์ใหญ่ได้', time: '10:08' },
      { id: 'm6', sender: 'Mina', text: 'เยี่ยมเลย กดแชร์ให้ชุมชนดูต่อได้ทันที', time: '10:12' }
    ]
  },
  {
    id: 'filedrop',
    name: 'Large File Drop',
    scope: 'ส่งไฟล์ใหญ่และไฟล์โปรเจกต์',
    unread: 0,
    lastMessage: 'ส่งไฟล์วิดีโอ โปรเจกต์ และเอกสารใหญ่',
    lastTime: '08:55',
    tone: 'project',
    messages: [
      { id: 'm7', sender: 'Nok', text: 'ไฟล์วิดีโอ 4K อัปโหลดผ่าน cloud storage ได้แล้ว', time: '08:20' },
      { id: 'm8', sender: 'Beam', text: 'ระบบจะแชร์ลิงก์ปลอดภัยให้คนรับโดยอัตโนมัติ', time: '08:44' },
      { id: 'm9', sender: 'Nok', text: 'รองรับ pause และ resume สำหรับไฟล์ใหญ่ในระบบจริง', time: '08:55' }
    ]
  },
  {
    id: 'private-nam',
    name: 'Nam · แชทส่วนตัว',
    scope: 'เข้ารหัสและเห็นเฉพาะคู่สนทนา',
    unread: 1,
    lastMessage: 'ส่งไฟล์สรุปให้แล้วนะ',
    lastTime: '11:24',
    tone: 'private',
    messages: [
      { id: 'm10', sender: 'Nam', text: 'ส่งไฟล์สรุปให้แล้วนะ ดูได้ตอนสะดวกเลย', time: '11:20' },
      { id: 'm11', sender: 'คุณ', text: 'ขอบคุณมาก เดี๋ยวอ่านแล้วตอบกลับครับ', time: '11:22', mine: true },
      { id: 'm12', sender: 'Nam', text: 'ถ้ามีจุดไหนอยากแก้ คุยในนี้ได้เลย', time: '11:24' }
    ]
  },
  {
    id: 'private-korn',
    name: 'Korn · แชทส่วนตัว',
    scope: 'เข้ารหัสและเห็นเฉพาะคู่สนทนา',
    unread: 0,
    lastMessage: 'คุยต่อหลังประชุมได้เลย',
    lastTime: '10:42',
    tone: 'private',
    messages: [
      { id: 'm13', sender: 'Korn', text: 'คุยต่อหลังประชุมได้เลยนะ', time: '10:40' },
      { id: 'm14', sender: 'คุณ', text: 'ได้ครับ ผมจะสรุปประเด็นไว้ให้ก่อน', time: '10:42', mine: true }
    ]
  }
];

export const moodPosts: MoodPost[] = [
  {
    id: 'p1',
    author: 'Ploy',
    team: 'Travel',
    mood: 'ดีใจ',
    text: 'ทริปวันนี้สวยมาก อัปโหลดรูปชุดใหญ่ไว้ให้เพื่อนดูแล้ว',
    time: '12 นาทีที่แล้ว',
    reactions: 18,
    comments: 4,
    shares: 3,
    kind: 'post'
  },
  {
    id: 'p-video',
    author: 'Beam',
    team: 'Creator',
    mood: 'คลิปสั้น',
    text: 'สรุป 3 เทคนิคทำคลิปไวรัลใน 30 วินาที ดูแล้วกดแชร์ให้เพื่อนได้เลย',
    time: '22 นาทีที่แล้ว',
    reactions: 42,
    comments: 11,
    shares: 8,
    kind: 'shortVideo'
  },
  {
    id: 'p2',
    author: 'Win',
    team: 'Design',
    mood: 'กำลังทำงาน',
    text: 'ส่งไฟล์ออกแบบขนาดใหญ่ให้ลูกค้าแล้ว ลิงก์ปลอดภัยเปิดได้ทุกอุปกรณ์',
    time: '38 นาทีที่แล้ว',
    reactions: 9,
    comments: 2,
    shares: 1,
    kind: 'post'
  },
  {
    id: 'p3',
    author: 'Ann',
    team: 'Community',
    mood: 'ขอบคุณ',
    text: 'วันนี้ได้เพื่อนใหม่จากหลายประเทศ แปลภาษาในแชทช่วยได้มาก',
    time: '1 ชม.ที่แล้ว',
    reactions: 24,
    comments: 7,
    shares: 2,
    kind: 'post'
  }
];
