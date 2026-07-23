import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import OpenAI from 'openai';

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const port = Number(process.env.ASSISTANT_PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-5.2';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'pl-chat-openai-assistant' });
});

app.post('/api/assistant/chat', async (request, response) => {
  try {
    const { userId, language = 'auto', message, history = [] } = request.body || {};
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';

    if (!trimmedMessage) {
      response.status(400).json({ error: 'message_required' });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      response.status(500).json({ error: 'missing_openai_api_key' });
      return;
    }

    const safeHistory = Array.isArray(history)
      ? history.slice(-12).flatMap((item) => {
          if (!item || typeof item.text !== 'string') return [];
          const role = item.role === 'assistant' ? 'assistant' : 'user';
          return [{ role, content: item.text.slice(0, 4000) }];
        })
      : [];

    const result = await openai.responses.create({
      model,
      instructions: [
        'You are ChatGPT inside PL CHAT, a public global social chat app.',
        'Act as a personal assistant for the signed-in user.',
        'Help with chat summaries, translation, writing posts, planning, productivity, and safe social communication.',
        'Keep private information private. Do not reveal other users private messages unless they are included in the current request.',
        `Reply in the user preferred language: ${language}. If language is auto, match the user's language.`
      ].join('\n'),
      input: [
        ...safeHistory,
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `User: ${userId || 'anonymous'}\nRequest: ${trimmedMessage}`
            }
          ]
        }
      ],
      max_output_tokens: 700
    });

    response.json({
      reply: result.output_text || 'ขออภัยครับ ตอนนี้ผู้ช่วยยังไม่มีคำตอบ',
      model
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'assistant_failed' });
  }
});

app.listen(port, () => {
  console.log(`PL CHAT OpenAI assistant is running on http://localhost:${port}`);
});

