// Bridge to the Android app (window.Android is injected by the APK's WebView).
export interface NativeBridge {
  getInfo(): string;
  getClipboard(): string;
  setClipboard(text: string): void;
  saveFileStart(id: string, name: string, mime: string): void;
  saveFileChunk(id: string, b64: string): void;
  saveFileEnd(id: string): string;
  openSaved(id: string): void;
  pickFiles(): void;
  readChunk(fid: string, offset: number, len: number): string;
  getNotifications(): string;
  dismissNotification(key: string): void;
  smsThreads(): string;
  smsMessages(address: string): string;
  sendSms(address: string, text: string): string;
  callLog(): string;
  dial(number: string): string;
  photos(limit: number): string;
  thumb(id: string): string;
  openMedia(id: string): string;
  ring(on: boolean): void;
  openUrl(url: string): void;
  vibrate(ms: number): void;
  permissions(): string;
  requestPermission(name: string): void;
  keepAlive(on: boolean, label: string): void;
  scanQr(): void;
  share(text: string): void;
}

export const native: NativeBridge | null = (window as any).Android ?? null;

type Handler = (data: any) => void;
const handlers = new Map<string, Set<Handler>>();

// Native calls window.__native.emit(name, jsonString)
(window as any).__native = {
  emit(name: string, json: string) {
    let data: any = json;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { /* plain string */ }
    handlers.get(name)?.forEach((h) => { try { h(data); } catch (e) { console.error(e); } });
  },
};

export function onNative(name: string, h: Handler) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name)!.add(h);
  return () => { handlers.get(name)?.delete(h); };
}

export function nativeJson<T = any>(fn: () => string, fallback: T): T {
  try { return JSON.parse(fn()) as T; } catch { return fallback; }
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(s);
}
