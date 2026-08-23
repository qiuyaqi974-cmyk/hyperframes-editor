import { createHmac } from 'node:crypto';
import WebSocket from 'ws';

const XFYUN_HOST = 'tts-api.xfyun.cn';
const XFYUN_PATH = '/v2/tts';
const MAX_TEXT_BYTES = 8000;

interface TTSRequest {
  text: string;
  voiceName: string;
  speed: number;
  volume: number;
}

function json(res: any, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function authUrl(apiKey: string, apiSecret: string) {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${XFYUN_HOST}\ndate: ${date}\nGET ${XFYUN_PATH} HTTP/1.1`;
  const signature = createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64');
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');
  const url = new URL(`wss://${XFYUN_HOST}${XFYUN_PATH}`);
  url.searchParams.set('authorization', authorization);
  url.searchParams.set('date', date);
  url.searchParams.set('host', XFYUN_HOST);
  return url.toString();
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > 1_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function synthesize(request: TTSRequest): Promise<string> {
  const appId = process.env.XFYUN_APP_ID;
  const apiKey = process.env.XFYUN_API_KEY;
  const apiSecret = process.env.XFYUN_API_SECRET;
  if (!appId || !apiKey || !apiSecret) {
    throw new Error('未找到 XFYUN_APP_ID、XFYUN_API_KEY 或 XFYUN_API_SECRET，请重启开发服务。');
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const socket = new WebSocket(authUrl(apiKey, apiSecret));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(`data:audio/mpeg;base64,${Buffer.concat(chunks).toString('base64')}`);
    };
    const timer = setTimeout(() => finish(new Error('讯飞 TTS 请求超时。')), 30_000);

    socket.once('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    socket.once('open', () => {
      socket.send(JSON.stringify({
        common: { app_id: appId },
        business: {
          aue: 'lame',
          auf: 'audio/L16;rate=16000',
          vcn: request.voiceName || 'x6_lingyuyan_pro',
          speed: clamp(request.speed, 0, 100, 60),
          volume: clamp(request.volume, 0, 100, 50),
          pitch: 50,
          tte: 'UTF8',
        },
        data: {
          status: 2,
          text: Buffer.from(request.text, 'utf8').toString('base64'),
          encoding: 'utf8',
        },
      }));
    });
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as {
          code?: number;
          message?: string;
          data?: { audio?: string; status?: number };
        };
        if (message.code && message.code !== 0) {
          finish(new Error(`讯飞 TTS 错误 ${message.code}: ${message.message ?? '未知错误'}`));
          return;
        }
        if (message.data?.audio) chunks.push(Buffer.from(message.data.audio, 'base64'));
        if (message.data?.status === 2) finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export function xfyunTTSProxy(req: any, res: any, next: () => void) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    json(res, 405, { error: '仅支持 POST 请求。' });
    return;
  }

  readBody(req)
    .then(async (raw) => {
      let request: TTSRequest;
      try {
        request = JSON.parse(raw) as TTSRequest;
      } catch {
        json(res, 400, { error: '请求体必须是 JSON。' });
        return;
      }
      if (!request.text?.trim()) {
        json(res, 400, { error: '配音文字不能为空。' });
        return;
      }
      if (Buffer.byteLength(request.text, 'utf8') > MAX_TEXT_BYTES) {
        json(res, 400, { error: `配音文字不能超过 ${MAX_TEXT_BYTES} 字节。` });
        return;
      }
      try {
        const src = await synthesize(request);
        json(res, 200, { src });
      } catch (error) {
        json(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
    })
    .catch((error) => json(res, 400, { error: error instanceof Error ? error.message : String(error) }));
}
