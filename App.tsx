import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import {
  Bell,
  CheckCheck,
  Globe2,
  Heart,
  Lock,
  LogOut,
  Mail,
  MessageSquare,
  MessageCircle,
  PlayCircle,
  Plus,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Smile,
  Users
} from 'lucide-react-native';
import { ChatRoom, Message, MoodPost, moodPosts as seedMoodPosts, rooms as seedRooms } from './src/data/mockData';
import { colors } from './src/theme/colors';

type Tab = 'chat' | 'mood' | 'people';
type AuthMode = 'login' | 'register' | 'verify';
type AppLanguage = 'auto' | 'th' | 'en' | 'zh' | 'ja' | 'ko' | 'ar' | 'es' | 'fr' | 'de' | 'hi' | 'vi' | 'id' | 'lo' | 'km';

const moodOptions = ['ดีใจ', 'สงบ', 'ขอบคุณ', 'กังวล', 'เหนื่อย'];
const sampleTranslations: Record<string, Partial<Record<AppLanguage, string>>> = {
  'สวัสดีจากกรุงเทพ วันนี้ใครมีคลิปหรือไฟล์ใหญ่แชร์ได้เลย': {
    en: 'Hello from Bangkok. If you have clips or large files today, feel free to share them.',
    zh: '来自曼谷的问候。今天如果有短视频或大文件，欢迎分享。'
  },
  'ผมอัปโหลดวิดีโอโปรเจกต์ใหม่ไว้ใน Cloud File แล้ว': {
    en: 'I uploaded the new project video to Cloud File.',
    zh: '我已经把新的项目视频上传到 Cloud File。'
  },
  'ดีมาก เดี๋ยวลองเปิดดูและแชร์ต่อให้เพื่อนครับ': {
    en: 'Great. I will open it and share it with friends.',
    zh: '太好了，我会打开看看并分享给朋友。'
  },
  'เยี่ยมเลย กดแชร์ให้ชุมชนดูต่อได้ทันที': {
    en: 'Great. You can share it with the community right away.',
    zh: '太好了，可以立即分享给社区。'
  },
  'ส่งไฟล์สรุปให้แล้วนะ ดูได้ตอนสะดวกเลย': {
    en: 'I sent the summary file. Please review it when convenient.',
    zh: '我已经发送了总结文件，方便时请查看。'
  },
  'ทริปวันนี้สวยมาก อัปโหลดรูปชุดใหญ่ไว้ให้เพื่อนดูแล้ว': {
    en: 'Today’s trip was beautiful. I uploaded a large photo set for friends to view.',
    zh: '今天的旅行很美。我已经上传了一大组照片给朋友看。'
  },
  'สรุป 3 เทคนิคทำคลิปไวรัลใน 30 วินาที ดูแล้วกดแชร์ให้เพื่อนได้เลย': {
    en: 'Three viral short-video tips in 30 seconds. Watch and share with friends.',
    zh: '30 秒总结 3 个 viral 短视频技巧。看完可以分享给朋友。'
  }
};

function translateSample(text: string, language: AppLanguage, enabled: boolean) {
  if (!enabled || language === 'auto' || language === 'th') {
    return text;
  }

  return sampleTranslations[text]?.[language] ?? sampleTranslations[text]?.en ?? text;
}
const languageOptions: Array<{ code: AppLanguage; label: string }> = [
  { code: 'auto', label: 'Auto' },
  { code: 'th', label: 'ไทย' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'ar', label: 'العربية' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'id', label: 'Indonesia' },
  { code: 'lo', label: 'ລາວ' },
  { code: 'km', label: 'ខ្មែរ' }
];

export default function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [registeredEmails, setRegisteredEmails] = useState<string[]>([]);
  const [appLanguage, setAppLanguage] = useState<AppLanguage>('auto');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [rooms, setRooms] = useState<ChatRoom[]>(seedRooms);
  const [selectedRoomId, setSelectedRoomId] = useState(seedRooms[0].id);
  const [draftMessage, setDraftMessage] = useState('');
  const [moodPosts, setMoodPosts] = useState<MoodPost[]>(seedMoodPosts);
  const [selectedMood, setSelectedMood] = useState(moodOptions[0]);
  const [moodDraft, setMoodDraft] = useState('');

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? rooms[0],
    [rooms, selectedRoomId]
  );

  const login = (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!registeredEmails.includes(normalizedEmail)) {
      return false;
    }

    setCurrentUser(normalizedEmail);
    return true;
  };

  const completeRegistration = (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    setRegisteredEmails((emails) =>
      emails.includes(normalizedEmail) ? emails : [...emails, normalizedEmail]
    );
  };

  const sendMessage = () => {
    const text = draftMessage.trim();
    if (!text) {
      return;
    }

    const message: Message = {
      id: `local-${Date.now()}`,
      sender: 'คุณ',
      text,
      time: 'ตอนนี้',
      mine: true
    };

    setRooms((currentRooms) =>
      currentRooms.map((room) =>
        room.id === selectedRoom.id
          ? {
              ...room,
              unread: 0,
              lastMessage: text,
              lastTime: 'ตอนนี้',
              messages: [...room.messages, message]
            }
          : room
      )
    );
    setDraftMessage('');
  };

  const publishMood = () => {
    const text = moodDraft.trim();
    if (!text) {
      return;
    }

    setMoodPosts((posts) => [
      {
        id: `post-${Date.now()}`,
        author: 'คุณ',
        team: 'PL CHAT',
        mood: selectedMood,
        text,
        time: 'ตอนนี้',
        reactions: 0,
        comments: 0,
        shares: 0,
        kind: 'post'
      },
      ...posts
    ]);
    setMoodDraft('');
  };

  if (!currentUser) {
    return (
      <SafeAreaView style={styles.shell}>
        <StatusBar barStyle="dark-content" />
        <AuthScreen
          onLogin={login}
          onRegistrationVerified={completeRegistration}
          language={appLanguage}
          onChangeLanguage={setAppLanguage}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <Header
          currentUser={currentUser}
          language={appLanguage}
          onChangeLanguage={setAppLanguage}
          autoTranslate={autoTranslate}
          onToggleTranslate={() => setAutoTranslate((value) => !value)}
          onSignOut={() => setCurrentUser(null)}
        />
        <View style={styles.content}>
          {activeTab === 'chat' && (
            <ChatWorkspace
              rooms={rooms}
              selectedRoom={selectedRoom}
              onSelectRoom={(roomId) => {
                setSelectedRoomId(roomId);
                setRooms((currentRooms) =>
                  currentRooms.map((room) => (room.id === roomId ? { ...room, unread: 0 } : room))
                );
              }}
              draftMessage={draftMessage}
              onChangeDraft={setDraftMessage}
              onSend={sendMessage}
              language={appLanguage}
              autoTranslate={autoTranslate}
            />
          )}
          {activeTab === 'mood' && (
            <MoodFeed
              posts={moodPosts}
              selectedMood={selectedMood}
              moodDraft={moodDraft}
              onSelectMood={setSelectedMood}
              onChangeMoodDraft={setMoodDraft}
              onPublish={publishMood}
              language={appLanguage}
              autoTranslate={autoTranslate}
            />
          )}
          {activeTab === 'people' && <PeopleDirectory />}
        </View>
        <BottomTabs activeTab={activeTab} onChange={setActiveTab} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthScreen({
  onLogin,
  onRegistrationVerified,
  language,
  onChangeLanguage
}: {
  onLogin: (email: string) => boolean;
  onRegistrationVerified: (email: string) => void;
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
}) {
  const [mode, setMode] = useState<AuthMode>('register');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [notice, setNotice] = useState('สมัครสมาชิกด้วยอีเมลส่วนตัวเพื่อรับรหัสยืนยัน');

  const normalizedEmail = email.trim().toLowerCase();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const isPasswordStrong = password.length >= 10 && /[A-Z]/.test(password) && /\d/.test(password);

  const startRegistration = () => {
    if (!fullName.trim()) {
      setNotice('กรุณากรอกชื่อผู้ใช้');
      return;
    }

    if (!isEmailValid) {
      setNotice('กรุณากรอกอีเมลให้ถูกต้อง');
      return;
    }

    if (!isPasswordStrong) {
      setNotice('รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร มีตัวพิมพ์ใหญ่ และมีตัวเลข');
      return;
    }

    setPendingEmail(normalizedEmail);
    setVerificationCode('');
    setMode('verify');
    setNotice(`ส่งรหัสยืนยัน 6 หลักไปที่ ${normalizedEmail} แล้ว`);
  };

  const verifyRegistration = () => {
    if (!/^\d{6}$/.test(verificationCode.trim())) {
      setNotice('กรุณากรอกรหัสยืนยัน 6 หลักจากอีเมล');
      return;
    }

    onRegistrationVerified(pendingEmail);
    setEmail(pendingEmail);
    setPassword('');
    setMode('login');
    setNotice('ยืนยันอีเมลสำเร็จแล้ว กรุณาล็อกอินด้วยบัญชีที่สมัครไว้');
  };

  const submitLogin = () => {
    if (!isEmailValid || !password.trim()) {
      setNotice('กรุณากรอกอีเมลและรหัสผ่าน');
      return;
    }

    if (!onLogin(normalizedEmail)) {
      setNotice('ต้องสมัครสมาชิกและยืนยันอีเมลก่อน จึงจะล็อกอินได้');
      return;
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.authShell}
    >
      <ScrollView contentContainerStyle={styles.authScroll} showsVerticalScrollIndicator={false}>
        <Image source={require('./assets/logo.png')} style={styles.authLogo} resizeMode="contain" />
        <View style={styles.authCard}>
          <View style={styles.authHeading}>
            <View style={styles.authIcon}>
              <ShieldCheck size={24} color={colors.surface} />
            </View>
            <View style={styles.authHeadingText}>
              <Text style={styles.authTitle}>
                {mode === 'login' ? 'เข้าสู่ระบบ PL CHAT' : mode === 'verify' ? 'ยืนยันอีเมล' : 'สมัครสมาชิก'}
              </Text>
              <Text style={styles.authSubtitle}>สมัครด้วยอีเมลส่วนตัวแบบโซเชียลทั่วไป และยืนยันตัวตนก่อนเข้าใช้งาน</Text>
            </View>
          </View>

          <View style={styles.authNotice}>
            <ShieldCheck size={17} color={colors.primaryDark} />
            <Text style={styles.authNoticeText}>{notice}</Text>
          </View>

          <LanguageSelector language={language} onChangeLanguage={onChangeLanguage} />

          {mode === 'register' && (
            <>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="ชื่อ-นามสกุล"
                placeholderTextColor={colors.softText}
                style={styles.authInput}
              />
              <View style={styles.authField}>
                <Mail size={18} color={colors.softText} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="อีเมลส่วนตัว"
                  placeholderTextColor={colors.softText}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.authFieldInput}
                />
              </View>
              <View style={styles.authField}>
                <Lock size={18} color={colors.softText} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="รหัสผ่านที่ปลอดภัย"
                  placeholderTextColor={colors.softText}
                  secureTextEntry
                  style={styles.authFieldInput}
                />
              </View>
              <Text style={styles.passwordHint}>อย่างน้อย 10 ตัวอักษร มีตัวพิมพ์ใหญ่ และตัวเลข</Text>
              <Pressable style={styles.authPrimaryButton} onPress={startRegistration} accessibilityRole="button">
                <Text style={styles.authPrimaryText}>สมัครและส่งรหัสยืนยัน</Text>
              </Pressable>
              <Pressable
                style={styles.authLinkButton}
                onPress={() => {
                  setMode('login');
                  setNotice('ล็อกอินได้เฉพาะบัญชีที่สมัครและยืนยันอีเมลแล้ว');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.authLinkText}>มีบัญชีแล้ว เข้าสู่ระบบ</Text>
              </Pressable>
            </>
          )}

          {mode === 'verify' && (
            <>
              <Text style={styles.verifyEmail}>{pendingEmail}</Text>
              <TextInput
                value={verificationCode}
                onChangeText={setVerificationCode}
                placeholder="รหัสยืนยัน 6 หลัก"
                placeholderTextColor={colors.softText}
                keyboardType="number-pad"
                maxLength={6}
                style={styles.verifyInput}
              />
              <Pressable style={styles.authPrimaryButton} onPress={verifyRegistration} accessibilityRole="button">
                <Text style={styles.authPrimaryText}>ยืนยันอีเมล</Text>
              </Pressable>
              <Pressable
                style={styles.authLinkButton}
                onPress={() => {
                  setMode('register');
                  setNotice('สมัครสมาชิกด้วยอีเมลส่วนตัวเพื่อรับรหัสยืนยัน');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.authLinkText}>แก้ไขข้อมูลสมัครสมาชิก</Text>
              </Pressable>
            </>
          )}

          {mode === 'login' && (
            <>
              <View style={styles.authField}>
                <Mail size={18} color={colors.softText} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="อีเมลที่ยืนยันแล้ว"
                  placeholderTextColor={colors.softText}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.authFieldInput}
                />
              </View>
              <View style={styles.authField}>
                <Lock size={18} color={colors.softText} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="รหัสผ่าน"
                  placeholderTextColor={colors.softText}
                  secureTextEntry
                  style={styles.authFieldInput}
                />
              </View>
              <Pressable style={styles.authPrimaryButton} onPress={submitLogin} accessibilityRole="button">
                <Text style={styles.authPrimaryText}>เข้าสู่ระบบ</Text>
              </Pressable>
              <Pressable
                style={styles.authLinkButton}
                onPress={() => {
                  setMode('register');
                  setNotice('สมัครสมาชิกด้วยอีเมลส่วนตัวเพื่อรับรหัสยืนยัน');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.authLinkText}>ยังไม่มีบัญชี สมัครสมาชิก</Text>
              </Pressable>
            </>
          )}

          <View style={styles.securityList}>
            <Text style={styles.securityItem}>ยืนยันอีเมลทุกครั้งที่สมัครสมาชิก</Text>
            <Text style={styles.securityItem}>ล็อกอินได้เฉพาะบัญชีที่ผ่านการยืนยันแล้ว</Text>
            <Text style={styles.securityItem}>รองรับ MFA, audit log และการป้องกันบัญชีปลอมในระบบจริง</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Header({
  currentUser,
  language,
  onChangeLanguage,
  autoTranslate,
  onToggleTranslate,
  onSignOut
}: {
  currentUser: string;
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
  autoTranslate: boolean;
  onToggleTranslate: () => void;
  onSignOut: () => void;
}) {
  const currentIndex = languageOptions.findIndex((option) => option.code === language);
  const nextLanguage = languageOptions[(currentIndex + 1) % languageOptions.length]?.code ?? 'auto';

  return (
    <View style={styles.header}>
      <View style={styles.brandMark}>
        <Image source={require('./assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />
      </View>
      <View style={styles.headerText}>
        <Text style={styles.orgName}>PL CHAT</Text>
        <Text style={styles.orgStatus}>{currentUser}</Text>
      </View>
      <Pressable style={styles.iconButton} accessibilityRole="button">
        <Search size={21} color={colors.ink} />
      </Pressable>
      <Pressable style={styles.iconButton} accessibilityRole="button">
        <Bell size={21} color={colors.ink} />
        <View style={styles.noticeDot} />
      </Pressable>
      <Pressable style={styles.iconButton} accessibilityRole="button" onPress={() => onChangeLanguage(nextLanguage)}>
        <Globe2 size={21} color={colors.ink} />
      </Pressable>
      <Pressable
        style={[styles.translateHeaderButton, autoTranslate && styles.translateHeaderButtonActive]}
        accessibilityRole="button"
        onPress={onToggleTranslate}
      >
        <Text style={[styles.translateHeaderText, autoTranslate && styles.translateHeaderTextActive]}>แปล</Text>
      </Pressable>
      <Pressable style={styles.iconButton} accessibilityRole="button" onPress={onSignOut}>
        <LogOut size={21} color={colors.ink} />
      </Pressable>
    </View>
  );
}

function LanguageSelector({
  language,
  onChangeLanguage
}: {
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
}) {
  return (
    <View style={styles.languagePanel}>
      <View style={styles.languageTitleRow}>
        <Globe2 size={17} color={colors.primaryDark} />
        <Text style={styles.languageTitle}>ภาษา / Language</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.languageRow}>
        {languageOptions.map((option) => (
          <Pressable
            key={option.code}
            onPress={() => onChangeLanguage(option.code)}
            style={[styles.languageChip, language === option.code && styles.languageChipActive]}
            accessibilityRole="button"
          >
            <Text style={[styles.languageChipText, language === option.code && styles.languageChipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.languageHint}>รองรับ Unicode/UTF-8 สำหรับทุกภาษา และเพิ่มชุดคำแปลใหม่ได้โดยไม่ทำให้ตัวอักษรเพี้ยน</Text>
    </View>
  );
}

function ChatWorkspace({
  rooms,
  selectedRoom,
  onSelectRoom,
  draftMessage,
  onChangeDraft,
  onSend,
  language,
  autoTranslate
}: {
  rooms: ChatRoom[];
  selectedRoom: ChatRoom;
  onSelectRoom: (roomId: string) => void;
  draftMessage: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  language: AppLanguage;
  autoTranslate: boolean;
}) {
  return (
    <View style={styles.chatWorkspace}>
      <FlatList
        data={rooms}
        horizontal
        style={styles.roomList}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.roomRail}
        renderItem={({ item }) => (
          <RoomChip room={item} isActive={item.id === selectedRoom.id} onPress={() => onSelectRoom(item.id)} />
        )}
      />
      <View style={styles.threadCard}>
        <View style={styles.threadHeader}>
          <View>
            <Text style={styles.threadTitle}>{selectedRoom.name}</Text>
            <Text style={styles.threadSubtitle}>{selectedRoom.scope}</Text>
          </View>
          <View style={styles.memberPill}>
            <Users size={16} color={colors.primaryDark} />
            <Text style={styles.memberPillText}>128</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.messages} showsVerticalScrollIndicator={false}>
          {selectedRoom.messages.map((message) => (
            <View
              key={message.id}
              style={[styles.messageRow, message.mine ? styles.messageRowMine : styles.messageRowOther]}
            >
              {!message.mine && <Avatar name={message.sender} />}
              <View style={[styles.bubble, message.mine ? styles.bubbleMine : styles.bubbleOther]}>
                {!message.mine && <Text style={styles.senderName}>{message.sender}</Text>}
                <Text style={[styles.messageText, message.mine && styles.messageTextMine]}>
                  {translateSample(message.text, language, autoTranslate)}
                </Text>
                {autoTranslate && translateSample(message.text, language, autoTranslate) !== message.text && (
                  <Text style={[styles.translatedCaption, message.mine && styles.translatedCaptionMine]}>แปลแล้ว</Text>
                )}
                <View style={styles.messageMeta}>
                  <Text style={[styles.messageTime, message.mine && styles.messageTimeMine]}>{message.time}</Text>
                  {message.mine && <CheckCheck size={14} color="#DFF8F2" />}
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={styles.composer}>
          <Pressable style={styles.addButton} accessibilityRole="button">
            <Plus size={20} color={colors.primaryDark} />
          </Pressable>
          <TextInput
            value={draftMessage}
            onChangeText={onChangeDraft}
            placeholder="พิมพ์ข้อความ แปลภาษา หรือแนบไฟล์ใหญ่"
            placeholderTextColor={colors.softText}
            style={styles.messageInput}
            returnKeyType="send"
            onSubmitEditing={onSend}
          />
          <Pressable style={styles.sendButton} accessibilityRole="button" onPress={onSend}>
            <Send size={18} color={colors.surface} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function RoomChip({ room, isActive, onPress }: { room: ChatRoom; isActive: boolean; onPress: () => void }) {
  const toneColor =
    room.tone === 'announce'
      ? colors.accent
      : room.tone === 'project'
        ? colors.blue
        : room.tone === 'private'
          ? colors.rose
          : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.roomChip, isActive && styles.roomChipActive]}
      accessibilityRole="button"
    >
      <View style={[styles.roomIcon, { backgroundColor: toneColor }]}>
        <MessageCircle size={17} color={colors.surface} />
      </View>
      <View style={styles.roomTextBox}>
        <Text style={styles.roomName} numberOfLines={1}>
          {room.name}
        </Text>
        <Text style={styles.roomMessage} numberOfLines={1}>
          {room.lastMessage}
        </Text>
      </View>
      {room.unread > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadText}>{room.unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

function MoodFeed({
  posts,
  selectedMood,
  moodDraft,
  onSelectMood,
  onChangeMoodDraft,
  onPublish,
  language,
  autoTranslate
}: {
  posts: MoodPost[];
  selectedMood: string;
  moodDraft: string;
  onSelectMood: (mood: string) => void;
  onChangeMoodDraft: (value: string) => void;
  onPublish: () => void;
  language: AppLanguage;
  autoTranslate: boolean;
}) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.feed}>
      <View style={styles.composerCard}>
        <View style={styles.feedHeader}>
          <Smile size={22} color={colors.primaryDark} />
          <View>
            <Text style={styles.feedTitle}>ฟีดรวม</Text>
            <Text style={styles.feedSubtitle}>โพสต์สั้น คลิปสั้น และบทสนทนาที่ทุกคนมีส่วนร่วมได้</Text>
          </View>
        </View>
        <View style={styles.moodPicker}>
          {moodOptions.map((mood) => (
            <Pressable
              key={mood}
              onPress={() => onSelectMood(mood)}
              style={[styles.moodChip, selectedMood === mood && styles.moodChipActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.moodChipText, selectedMood === mood && styles.moodChipTextActive]}>{mood}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={moodDraft}
          onChangeText={onChangeMoodDraft}
          multiline
          placeholder="เล่าให้เพื่อนและผู้ติดตามฟังแบบสั้น ๆ"
          placeholderTextColor={colors.softText}
          style={styles.moodInput}
        />
        <Pressable onPress={onPublish} style={styles.publishButton} accessibilityRole="button">
          <Text style={styles.publishButtonText}>โพสต์ความรู้สึก</Text>
        </Pressable>
      </View>
      {posts.map((post) => (
        <View key={post.id} style={styles.postCard}>
          <View style={styles.postTop}>
            <Avatar name={post.author} />
            <View style={styles.postAuthorBox}>
              <Text style={styles.postAuthor}>{post.author}</Text>
              <Text style={styles.postTeam}>
                {post.team} · {post.time}
              </Text>
            </View>
            <View style={styles.postMood}>
              <Text style={styles.postMoodText}>{post.mood}</Text>
            </View>
          </View>
          <Text style={styles.postText}>{translateSample(post.text, language, autoTranslate)}</Text>
          {autoTranslate && translateSample(post.text, language, autoTranslate) !== post.text && (
            <Text style={styles.translatedPostCaption}>แปลเป็นภาษาที่ตั้งค่าไว้</Text>
          )}
          {post.kind === 'shortVideo' && (
            <View style={styles.shortVideoCard}>
              <PlayCircle size={30} color={colors.surface} />
              <Text style={styles.shortVideoText}>คลิปสั้น</Text>
            </View>
          )}
          <View style={styles.postFooter}>
            <View style={styles.socialAction}>
              <Heart size={17} color={colors.rose} />
              <Text style={styles.reactionText}>{post.reactions}</Text>
            </View>
            <View style={styles.socialAction}>
              <MessageSquare size={17} color={colors.muted} />
              <Text style={styles.reactionText}>{post.comments}</Text>
            </View>
            <View style={styles.socialAction}>
              <Share2 size={17} color={colors.muted} />
              <Text style={styles.reactionText}>{post.shares}</Text>
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function PeopleDirectory() {
  const teams = [
    { name: 'Global Square', people: 2400, status: 'ชุมชนสาธารณะทั่วโลก' },
    { name: 'Creator Hub', people: 1800, status: 'คลิปสั้น ไลฟ์ และคอนเทนต์' },
    { name: 'Large File Drop', people: 920, status: 'ส่งไฟล์ใหญ่และแชร์ลิงก์ปลอดภัย' },
    { name: 'Mini Tools', people: 760, status: 'เครื่องมือย่อยแบบ WeChat' },
    { name: 'AI Assistant', people: 1280, status: 'ChatGPT ผู้ช่วยส่วนตัวสำหรับผู้ใช้ทุกคน' },
    { name: 'Public Profiles', people: 3100, status: 'ตกแต่งรูปโปรไฟล์และข้อมูลให้เพื่อนเห็น' },
    { name: 'Room Settings', people: 640, status: 'ตั้งชื่อกลุ่มและแก้ชื่อห้องแชทต่างๆ' }
  ];

  return (
    <ScrollView contentContainerStyle={styles.directory}>
      <Text style={styles.directoryTitle}>แดชบอร์ด</Text>
      <View style={styles.dashboardGrid}>
        <View style={styles.dashboardMetric}>
          <Text style={styles.dashboardNumber}>86</Text>
          <Text style={styles.dashboardLabel}>การมีส่วนร่วม</Text>
        </View>
        <View style={styles.dashboardMetric}>
          <Text style={styles.dashboardNumber}>12</Text>
          <Text style={styles.dashboardLabel}>โพสต์ใหม่</Text>
        </View>
        <View style={styles.dashboardMetric}>
          <Text style={styles.dashboardNumber}>5</Text>
          <Text style={styles.dashboardLabel}>แชทส่วนตัว</Text>
        </View>
        <View style={styles.dashboardMetric}>
          <Text style={styles.dashboardNumber}>3</Text>
          <Text style={styles.dashboardLabel}>คลิปสั้น</Text>
        </View>
      </View>
      <Text style={styles.directoryTitle}>ศูนย์เครื่องมือ</Text>
      <View style={styles.toolCenterGrid}>
        <View style={styles.toolCenterTile}><Text style={styles.toolCenterTitle}>Cloud File</Text><Text style={styles.toolCenterText}>ส่งไฟล์ใหญ่และแชร์ลิงก์ปลอดภัย</Text></View>
        <View style={styles.toolCenterTile}><Text style={styles.toolCenterTitle}>AI Assistant</Text><Text style={styles.toolCenterText}>ChatGPT ช่วยสรุป แปลภาษา และเขียนโพสต์</Text></View>
        <View style={styles.toolCenterTile}><Text style={styles.toolCenterTitle}>Profile</Text><Text style={styles.toolCenterText}>แก้รูป ชื่อ ข้อมูลส่วนตัว และหน้าโปรไฟล์สาธารณะ</Text></View>
        <View style={styles.toolCenterTile}><Text style={styles.toolCenterTitle}>Room Names</Text><Text style={styles.toolCenterText}>ตั้งชื่อกลุ่มและแก้ชื่อห้องแชทได้</Text></View>
        <View style={styles.toolCenterTile}><Text style={styles.toolCenterTitle}>QR</Text><Text style={styles.toolCenterText}>เพิ่มเพื่อน กลุ่ม และ mini tools</Text></View>
        <View style={styles.toolCenterTile}><Text style={styles.toolCenterTitle}>Translate</Text><Text style={styles.toolCenterText}>แปลแชทและโพสต์อัตโนมัติ</Text></View>
        <View style={styles.toolCenterTile}><Text style={styles.toolCenterTitle}>Moments</Text><Text style={styles.toolCenterText}>โพสต์ คลิปสั้น ไลค์ แชร์</Text></View>
      </View>
      {teams.map((team) => (
        <View key={team.name} style={styles.teamCard}>
          <View style={styles.teamIcon}>
            <Users size={20} color={colors.primaryDark} />
          </View>
          <View style={styles.teamCopy}>
            <Text style={styles.teamName}>{team.name}</Text>
            <Text style={styles.teamStatus}>{team.status}</Text>
          </View>
          <Text style={styles.teamCount}>{team.people}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function BottomTabs({ activeTab, onChange }: { activeTab: Tab; onChange: (tab: Tab) => void }) {
  const tabs = [
    { id: 'chat' as const, label: 'แชท', Icon: MessageCircle },
    { id: 'mood' as const, label: 'ฟีด', Icon: Smile },
    { id: 'people' as const, label: 'แดชบอร์ด', Icon: Users }
  ];

  return (
    <View style={styles.tabs}>
      {tabs.map(({ id, label, Icon }) => {
        const isActive = activeTab === id;
        return (
          <Pressable key={id} onPress={() => onChange(id)} style={styles.tabButton} accessibilityRole="button">
            <Icon size={23} color={isActive ? colors.primary : colors.softText} />
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.canvas
  },
  keyboard: {
    flex: 1
  },
  authShell: {
    flex: 1,
    backgroundColor: colors.canvas
  },
  authScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 18
  },
  authLogo: {
    alignSelf: 'center',
    width: 170,
    height: 122,
    marginBottom: 16
  },
  authCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: 8,
    padding: 18,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1
  },
  authHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  authIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary
  },
  authHeadingText: {
    flex: 1
  },
  authTitle: {
    color: colors.ink,
    fontSize: 23,
    fontWeight: '800'
  },
  authSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3
  },
  authNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 14,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.primarySoft
  },
  authNoticeText: {
    flex: 1,
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18
  },
  languagePanel: {
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
    backgroundColor: colors.surface
  },
  languageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 9
  },
  languageTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '800'
  },
  languageRow: {
    gap: 8,
    paddingRight: 6
  },
  languageChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    paddingHorizontal: 11,
    backgroundColor: colors.canvas
  },
  languageChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary
  },
  languageChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800'
  },
  languageChipTextActive: {
    color: colors.surface
  },
  languageHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 9
  },
  authInput: {
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 13,
    color: colors.ink,
    backgroundColor: colors.canvas,
    fontSize: 15,
    marginBottom: 10
  },
  authField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 8,
    paddingHorizontal: 13,
    backgroundColor: colors.canvas,
    marginBottom: 10
  },
  authFieldInput: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    minHeight: 48
  },
  passwordHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12
  },
  authPrimaryButton: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary
  },
  authPrimaryText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '800'
  },
  authLinkButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8
  },
  authLinkText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: '800'
  },
  verifyEmail: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10
  },
  verifyInput: {
    minHeight: 54,
    borderRadius: 8,
    paddingHorizontal: 13,
    color: colors.ink,
    backgroundColor: colors.canvas,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 12
  },
  securityList: {
    gap: 7,
    marginTop: 16,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingTop: 13
  },
  securityItem: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: colors.surface,
    borderBottomColor: colors.line,
    borderBottomWidth: 1
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    overflow: 'hidden'
  },
  brandLogo: {
    width: 36,
    height: 36
  },
  headerText: {
    flex: 1
  },
  orgName: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800'
  },
  orgStatus: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas
  },
  noticeDot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.rose
  },
  translateHeaderButton: {
    minWidth: 48,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.canvas
  },
  translateHeaderButtonActive: {
    backgroundColor: colors.primary
  },
  translateHeaderText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800'
  },
  translateHeaderTextActive: {
    color: colors.surface
  },
  content: {
    flex: 1
  },
  chatWorkspace: {
    flex: 1
  },
  roomList: {
    maxHeight: 98
  },
  roomRail: {
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  roomChip: {
    width: 255,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line
  },
  roomChipActive: {
    borderColor: colors.primary,
    backgroundColor: '#F9FFFD'
  },
  roomIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  roomTextBox: {
    flex: 1
  },
  roomName: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800'
  },
  roomMessage: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3
  },
  unreadBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    backgroundColor: colors.rose
  },
  unreadText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '800'
  },
  threadCard: {
    flex: 1,
    marginHorizontal: 14,
    marginBottom: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    overflow: 'hidden'
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomColor: colors.line,
    borderBottomWidth: 1
  },
  threadTitle: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '800'
  },
  threadSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2
  },
  memberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.primarySoft
  },
  memberPillText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '800'
  },
  messages: {
    gap: 12,
    padding: 16,
    paddingBottom: 24
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8
  },
  messageRowMine: {
    justifyContent: 'flex-end'
  },
  messageRowOther: {
    justifyContent: 'flex-start'
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft
  },
  avatarText: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: '800'
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  bubbleMine: {
    backgroundColor: colors.primary
  },
  bubbleOther: {
    backgroundColor: colors.canvas
  },
  senderName: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4
  },
  messageText: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21
  },
  messageTextMine: {
    color: colors.surface
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    marginTop: 6
  },
  translatedCaption: {
    color: colors.softText,
    fontSize: 11,
    marginTop: 5
  },
  translatedCaptionMine: {
    color: '#DFF8F2'
  },
  messageTime: {
    color: colors.softText,
    fontSize: 11
  },
  messageTimeMine: {
    color: '#DFF8F2'
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    backgroundColor: colors.surface
  },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft
  },
  messageInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 13,
    color: colors.ink,
    backgroundColor: colors.canvas,
    fontSize: 15
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary
  },
  feed: {
    gap: 12,
    padding: 14,
    paddingBottom: 24
  },
  composerCard: {
    borderRadius: 8,
    padding: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line
  },
  feedHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center'
  },
  feedTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800'
  },
  feedSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2
  },
  moodPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14
  },
  moodChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.line
  },
  moodChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  moodChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  moodChipTextActive: {
    color: colors.surface
  },
  moodInput: {
    minHeight: 88,
    marginTop: 12,
    borderRadius: 8,
    padding: 12,
    textAlignVertical: 'top',
    color: colors.ink,
    backgroundColor: colors.canvas,
    fontSize: 15,
    lineHeight: 21
  },
  publishButton: {
    height: 44,
    marginTop: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary
  },
  publishButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '800'
  },
  postCard: {
    borderRadius: 8,
    padding: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line
  },
  postTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  postAuthorBox: {
    flex: 1
  },
  postAuthor: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800'
  },
  postTeam: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2
  },
  postMood: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.primarySoft
  },
  postMoodText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '800'
  },
  postText: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12
  },
  translatedPostCaption: {
    color: colors.softText,
    fontSize: 11,
    marginTop: 6
  },
  shortVideoCard: {
    minHeight: 138,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.primary
  },
  shortVideoText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '800'
  },
  postFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 13
  },
  socialAction: {
    minHeight: 36,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.surface
  },
  reactionText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  directory: {
    padding: 14,
    gap: 10
  },
  directoryTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 3
  },
  dashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12
  },
  dashboardMetric: {
    width: '48%',
    minHeight: 82,
    borderRadius: 8,
    padding: 13,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1
  },
  dashboardNumber: {
    color: colors.primaryDark,
    fontSize: 25,
    fontWeight: '800'
  },
  dashboardLabel: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4
  },
  toolCenterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12
  },
  toolCenterTile: {
    width: '48%',
    minHeight: 92,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1
  },
  toolCenterTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800'
  },
  toolCenterText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5
  },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line
  },
  teamIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft
  },
  teamCopy: {
    flex: 1
  },
  teamName: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800'
  },
  teamStatus: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 3
  },
  teamCount: {
    color: colors.primaryDark,
    fontSize: 18,
    fontWeight: '800'
  },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 18 : 10,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    backgroundColor: colors.surface
  },
  tabButton: {
    width: 98,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  tabText: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: '800'
  },
  tabTextActive: {
    color: colors.primary
  }
});
