import Peer, { DataConnection } from 'peerjs';
import { getState, setState, toast, uid, Notif, DeviceInfo, Transfer } from './store';
import { native, nativeJson, b64ToBytes, bytesToB64, onNative } from './native';

const PREFIX = 'smrk-v1-';
const CHUNK = 64 * 1024;
const PEER_CFG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
  debug: 0 as const,
};

let peer: Peer | null = null;
let conn: DataConnection | null = null;
let retryTimer: number | undefined;
const pendingRpc = new Map<string, { res: (v: any) => void; rej: (e: any) => void }>();
const incoming = new Map<string, { chunks: Uint8Array[]; meta: Transfer }>();
export const bus = new EventTarget();

const LS_HOST = 'sr.hostId';
const LS_TRUST = 'sr.trusted';
const LS_PAIR = 'sr.pairing';

const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789';
const randId = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => ALPH[b % ALPH.length]).join('');
const randPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');

export function deviceName(): string {
  if (native) {
    const i = nativeJson<DeviceInfo>(() => native!.getInfo(), {});
    return i.model || 'Android';
  }
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : 'PC';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} (${br})`;
}

export function getPairing(): { hostId: string; token: string; hostName?: string } | null {
  try { return JSON.parse(localStorage.getItem(LS_PAIR) || 'null'); } catch { return null; }
}

export function pairUrl() {
  const s = getState();
  return `${location.origin}/?pair=${s.hostId}.${s.pin}`;
}

/* ---------------------------------------------------------------- send */

export function isConnected() { return !!conn && conn.open && getState().status === 'connected'; }

export function send(msg: any) {
  if (conn && conn.open) conn.send(msg);
}

export function rpc<T = any>(method: string, params: any = {}, timeout = 20000): Promise<T> {
  return new Promise((res, rej) => {
    if (!isConnected()) return rej(new Error('未接続です'));
    const id = uid();
    pendingRpc.set(id, { res, rej });
    send({ t: 'rpc', id, method, params });
    setTimeout(() => { if (pendingRpc.delete(id)) rej(new Error('タイムアウトしました')); }, timeout);
  });
}

type RpcHandler = (params: any) => any | Promise<any>;
const rpcHandlers: Record<string, RpcHandler> = {};
export function handleRpc(method: string, h: RpcHandler) { rpcHandlers[method] = h; }

/* ------------------------------------------------------------- pairing */

export function startHost() {
  stop();
  let hostId = localStorage.getItem(LS_HOST);
  if (!hostId) { hostId = randId(6); localStorage.setItem(LS_HOST, hostId); }
  setState({ hostId, pin: randPin(), status: 'connecting', error: undefined });
  peer = new Peer(PREFIX + hostId, PEER_CFG);
  peer.on('open', () => { if (getState().status !== 'connected') setState({ status: 'waiting' }); });
  peer.on('disconnected', () => { setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 2000); });
  peer.on('error', (e: any) => {
    if (e.type === 'unavailable-id') {
      setState({ status: 'error', error: 'このPCのIDは別のタブで使用中です。他のタブを閉じてください。' });
      clearTimeout(retryTimer);
      retryTimer = window.setTimeout(startHost, 8000);
    } else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') {
      setState({ status: 'connecting' });
      clearTimeout(retryTimer);
      retryTimer = window.setTimeout(startHost, 5000);
    }
  });
  peer.on('connection', (c) => {
    let authed = false;
    c.on('data', (d: any) => {
      if (!authed) {
        if (d?.t !== 'hello') return;
        const trusted: string[] = JSON.parse(localStorage.getItem(LS_TRUST) || '[]');
        if ((d.token && trusted.includes(d.token)) || (d.pin && d.pin === getState().pin)) {
          authed = true;
          const token = d.token && trusted.includes(d.token) ? d.token : randId(24);
          if (!trusted.includes(token)) localStorage.setItem(LS_TRUST, JSON.stringify([...trusted.slice(-4), token]));
          if (conn && conn !== c) { try { conn.close(); } catch { /* */ } }
          conn = c;
          c.send({ t: 'welcome', token, name: deviceName() });
          setState({ status: 'connected', peerName: d.name, pin: randPin(), notifs: [] });
          toast(`${d.name || 'スマートフォン'} と接続しました`);
          bus.dispatchEvent(new Event('connected'));
        } else {
          c.send({ t: 'reject', reason: 'PINが一致しません' });
          setTimeout(() => c.close(), 500);
        }
        return;
      }
      onMessage(d);
    });
    c.on('close', () => {
      if (conn === c) {
        conn = null;
        setState({ status: 'waiting', device: null });
        bus.dispatchEvent(new Event('disconnected'));
      }
    });
    c.on('error', () => { /* handled by close */ });
  });
}

export function startClient(hostId?: string, pin?: string) {
  stop();
  const saved = getPairing();
  const target = hostId || saved?.hostId;
  if (!target) { setState({ status: 'idle' }); return; }
  setState({ status: 'connecting', error: undefined, hostId: target });
  peer = new Peer(PEER_CFG);
  const connect = () => {
    if (!peer || peer.destroyed) return;
    const c = peer.connect(PREFIX + target, { reliable: true });
    let welcomed = false;
    c.on('open', () => {
      c.send({ t: 'hello', role: 'phone', name: deviceName(), token: saved?.hostId === target ? saved?.token : undefined, pin });
    });
    c.on('data', (d: any) => {
      if (!welcomed) {
        if (d?.t === 'welcome') {
          welcomed = true;
          conn = c;
          localStorage.setItem(LS_PAIR, JSON.stringify({ hostId: target, token: d.token, hostName: d.name }));
          pin = undefined;
          setState({ status: 'connected', peerName: d.name });
          native?.keepAlive(true, `${d.name} と接続中`);
          native?.vibrate(30);
          bus.dispatchEvent(new Event('connected'));
        } else if (d?.t === 'reject') {
          setState({ status: 'error', error: d.reason || '接続が拒否されました' });
          localStorage.removeItem(LS_PAIR);
          stop();
        }
        return;
      }
      onMessage(d);
    });
    c.on('close', () => {
      if (conn === c) {
        conn = null;
        native?.keepAlive(true, '再接続しています…');
        setState({ status: 'connecting' });
        bus.dispatchEvent(new Event('disconnected'));
      }
      if (getPairing() || pin) { clearTimeout(retryTimer); retryTimer = window.setTimeout(connect, 3000); }
    });
  };
  peer.on('open', connect);
  peer.on('disconnected', () => { setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 2000); });
  peer.on('error', (e: any) => {
    if (e.type === 'peer-unavailable') {
      setState({ status: 'connecting', error: 'PCが見つかりません。PCでスマートフォン連携を開いてください。' });
      clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, 5000);
    } else if (['network', 'server-error', 'socket-error', 'disconnected'].includes(e.type)) {
      clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => startClient(target, pin), 5000);
    }
  });
}

export function stop() {
  clearTimeout(retryTimer);
  try { conn?.close(); } catch { /* */ }
  try { peer?.destroy(); } catch { /* */ }
  conn = null; peer = null;
}

export function unpair() {
  if (getState().role === 'phone') { localStorage.removeItem(LS_PAIR); native?.keepAlive(false, ''); }
  else { localStorage.removeItem(LS_TRUST); }
  stop();
  setState({ status: 'idle', peerName: undefined, device: null, notifs: [] });
  if (getState().role === 'pc') startHost();
}

/* ------------------------------------------------------------- receive */

function onMessage(d: any) {
  if (!d || typeof d !== 'object') return;
  switch (d.t) {
    case 'info':
      setState({ device: d.device });
      bus.dispatchEvent(new CustomEvent('info', { detail: d.device }));
      break;
    case 'clip':
      receiveClip(d.text);
      break;
    case 'url':
      if (native) native.openUrl(d.url); else window.open(d.url, '_blank', 'noopener');
      toast('リンクを開きました');
      break;
    case 'notif-list':
      setState({ notifs: d.items });
      break;
    case 'notif': {
      const n: Notif = d.item;
      setState((s) => ({ notifs: [n, ...s.notifs.filter((x) => x.key !== n.key)].slice(0, 200) }));
      bus.dispatchEvent(new CustomEvent('notif', { detail: n }));
      break;
    }
    case 'notif-remove':
      setState((s) => ({ notifs: s.notifs.filter((x) => x.key !== d.key) }));
      break;
    case 'notif-dismiss':
      native?.dismissNotification(d.key);
      break;
    case 'event':
      bus.dispatchEvent(new CustomEvent(d.name, { detail: d.data }));
      break;
    case 'rpc': {
      const h = rpcHandlers[d.method];
      Promise.resolve()
        .then(() => { if (!h) throw new Error('未対応の操作です'); return h(d.params || {}); })
        .then((result) => send({ t: 'rpc-res', id: d.id, result }))
        .catch((e) => send({ t: 'rpc-res', id: d.id, error: String(e?.message || e) }));
      break;
    }
    case 'rpc-res': {
      const p = pendingRpc.get(d.id);
      if (p) { pendingRpc.delete(d.id); d.error ? p.rej(new Error(d.error)) : p.res(d.result); }
      break;
    }
    case 'file-offer': onFileOffer(d); break;
    case 'file-chunk': onFileChunk(d); break;
    case 'file-end': onFileEnd(d); break;
    case 'file-cancel': {
      incoming.delete(d.id);
      updateTransfer(d.id, { status: 'error' });
      break;
    }
  }
}

/* ------------------------------------------------------------ clipboard */

let lastClip = '';
export function noteLocalClip(text: string) { lastClip = text; }

export function sendClip(text: string) {
  if (!text || !isConnected()) return false;
  lastClip = text;
  send({ t: 'clip', text });
  setState((s) => ({ clips: [{ text, from: 'me' as const, ts: Date.now() }, ...s.clips].slice(0, 100) }));
  return true;
}

function receiveClip(text: string) {
  lastClip = text;
  setState((s) => ({ clips: [{ text, from: 'peer' as const, ts: Date.now() }, ...s.clips].slice(0, 100) }));
  const s = getState();
  if (native) {
    native.setClipboard(text);
    toast('クリップボードを受信しました');
  } else if (s.settings.autoClip && document.hasFocus()) {
    navigator.clipboard?.writeText(text).then(
      () => toast('クリップボードを受信・コピーしました'),
      () => toast('クリップボードを受信しました', 'コピー', () => navigator.clipboard.writeText(text)),
    );
  } else {
    toast('クリップボードを受信しました', 'コピー', () => navigator.clipboard?.writeText(text));
  }
}

export async function checkLocalClipboard() {
  if (!isConnected() || !getState().settings.autoClip) return;
  let text = '';
  try {
    if (native) text = native.getClipboard();
    else if (document.hasFocus() && navigator.clipboard?.readText) text = await navigator.clipboard.readText();
  } catch { return; }
  if (text && text !== lastClip) sendClip(text);
}

/* ---------------------------------------------------------------- files */

function updateTransfer(id: string, p: Partial<Transfer>) {
  setState((s) => ({ transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
}

export interface FileSource { name: string; size: number; mime: string; read: (offset: number, len: number) => Promise<Uint8Array> }

export function sourceFromFile(f: File): FileSource {
  return {
    name: f.name, size: f.size, mime: f.type || 'application/octet-stream',
    read: async (o, l) => new Uint8Array(await f.slice(o, o + l).arrayBuffer()),
  };
}

export function sourceFromNative(fid: string, name: string, size: number, mime: string): FileSource {
  return { name, size, mime, read: async (o, l) => b64ToBytes(native!.readChunk(fid, o, l)) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendFile(src: FileSource) {
  if (!isConnected()) { toast('未接続です'); return; }
  const id = uid();
  const t: Transfer = { id, name: src.name, size: src.size, mime: src.mime, dir: 'out', received: 0, status: 'active', ts: Date.now() };
  setState((s) => ({ transfers: [t, ...s.transfers] }));
  send({ t: 'file-offer', id, name: src.name, size: src.size, mime: src.mime });
  let off = 0; let lastUi = 0;
  try {
    while (off < src.size) {
      if (!conn || !conn.open) throw new Error('closed');
      const dc = (conn as any).dataChannel as RTCDataChannel | undefined;
      while (dc && dc.bufferedAmount > 4 * 1024 * 1024) await sleep(15);
      const chunk = await src.read(off, Math.min(CHUNK, src.size - off));
      if (!chunk.length) break;
      send({ t: 'file-chunk', id, data: chunk });
      off += chunk.length;
      if (Date.now() - lastUi > 120) { lastUi = Date.now(); updateTransfer(id, { received: off }); }
    }
    send({ t: 'file-end', id });
    updateTransfer(id, { received: src.size, status: 'done' });
  } catch {
    send({ t: 'file-cancel', id });
    updateTransfer(id, { status: 'error' });
  }
}

function onFileOffer(d: any) {
  const meta: Transfer = { id: d.id, name: d.name, size: d.size, mime: d.mime, dir: 'in', received: 0, status: 'active', ts: Date.now() };
  incoming.set(d.id, { chunks: [], meta });
  if (native) native.saveFileStart(d.id, d.name, d.mime || 'application/octet-stream');
  setState((s) => ({ transfers: [meta, ...s.transfers] }));
}

let lastChunkUi = 0;
function onFileChunk(d: any) {
  const f = incoming.get(d.id);
  if (!f) return;
  const bytes = d.data instanceof Uint8Array ? d.data : new Uint8Array(d.data);
  if (native) native.saveFileChunk(d.id, bytesToB64(bytes));
  else f.chunks.push(bytes);
  f.meta.received += bytes.length;
  if (Date.now() - lastChunkUi > 120) { lastChunkUi = Date.now(); updateTransfer(d.id, { received: f.meta.received }); }
}

function onFileEnd(d: any) {
  const f = incoming.get(d.id);
  if (!f) return;
  incoming.delete(d.id);
  if (native) {
    native.saveFileEnd(d.id);
    updateTransfer(d.id, { received: f.meta.size, status: 'done', nativeId: d.id });
    toast(`${f.meta.name} を保存しました`, '開く', () => native!.openSaved(d.id));
  } else {
    const blob = new Blob(f.chunks as BlobPart[], { type: f.meta.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    updateTransfer(d.id, { received: f.meta.size, status: 'done', url });
    const a = document.createElement('a');
    a.href = url; a.download = f.meta.name; document.body.appendChild(a); a.click(); a.remove();
    toast(`${f.meta.name} を受信しました`);
  }
}

/* -------------------------------------------------- phone-side services */

export function phoneInfo(): DeviceInfo {
  if (native) return { ...nativeJson<DeviceInfo>(() => native!.getInfo(), {}), native: true };
  const nav: any = navigator;
  return { model: deviceName(), network: nav.connection?.effectiveType, native: false };
}

export function setupPhoneServices() {
  // Push device info and notifications on connect
  bus.addEventListener('connected', async () => {
    const info = phoneInfo();
    if (!native) {
      try {
        const b = await (navigator as any).getBattery?.();
        if (b) { info.battery = Math.round(b.level * 100); info.charging = b.charging; }
      } catch { /* */ }
    }
    send({ t: 'info', device: info });
    if (native) send({ t: 'notif-list', items: nativeJson<Notif[]>(() => native!.getNotifications(), []) });
    checkLocalClipboard();
  });
  setInterval(() => { if (isConnected()) send({ t: 'info', device: phoneInfo() }); }, 60_000);

  if (native) {
    onNative('notification', (n: Notif) => isConnected() && send({ t: 'notif', item: n }));
    onNative('notificationRemoved', (d: { key: string }) => isConnected() && send({ t: 'notif-remove', key: d.key }));
    onNative('battery', () => isConnected() && send({ t: 'info', device: phoneInfo() }));
    onNative('sms', (m: any) => isConnected() && send({ t: 'event', name: 'sms', data: m }));
    onNative('resume', () => { checkLocalClipboard(); if (!isConnected() && getPairing()) startClient(); });
    onNative('clipboard', () => checkLocalClipboard());
    onNative('files', (list: { fid: string; name: string; size: number; mime: string }[]) => {
      list.forEach((f) => sendFile(sourceFromNative(f.fid, f.name, f.size, f.mime)));
    });
    onNative('shared', (d: { text?: string; files?: { fid: string; name: string; size: number; mime: string }[] }) => {
      if (!isConnected()) { toast('PCと接続してから共有してください'); return; }
      if (d.text) {
        if (/^https?:\/\/\S+$/.test(d.text.trim())) send({ t: 'url', url: d.text.trim() });
        else sendClip(d.text);
        toast('PCに送信しました');
      }
      d.files?.forEach((f) => sendFile(sourceFromNative(f.fid, f.name, f.size, f.mime)));
    });

    const nj = (fn: () => string) => {
      const v = JSON.parse(fn() || 'null');
      if (v && !Array.isArray(v) && typeof v === 'object' && v.error) throw new Error(v.error);
      return v;
    };
    handleRpc('sms.threads', () => nj(() => native!.smsThreads()));
    handleRpc('sms.messages', (p) => nj(() => native!.smsMessages(p.address)));
    handleRpc('sms.send', (p) => {
      const r = nativeJson<{ ok: boolean; error?: string }>(() => native!.sendSms(p.address, p.text), { ok: false });
      if (!r.ok) throw new Error(r.error || '送信できませんでした');
      return r;
    });
    handleRpc('calls.list', () => nj(() => native!.callLog()));
    handleRpc('calls.dial', (p) => {
      const r = nativeJson<{ ok: boolean; error?: string }>(() => native!.dial(p.number), { ok: false });
      if (!r.ok) throw new Error(r.error || '発信できませんでした');
      return r;
    });
    handleRpc('photos.list', (p) => nj(() => native!.photos(p.limit || 60)));
    handleRpc('photos.thumb', (p) => native!.thumb(p.id));
    handleRpc('photos.send', (p) => {
      (p.ids as string[]).forEach((id) => {
        const m = nativeJson<any>(() => native!.openMedia(id), null);
        if (m) sendFile(sourceFromNative(m.fid, m.name, m.size, m.mime));
      });
      return true;
    });
    handleRpc('notif.list', () => nativeJson(() => native!.getNotifications(), []));
    handleRpc('perms', () => nativeJson(() => native!.permissions(), {}));
  }
  handleRpc('ring', (p) => {
    if (native) native.ring(!!p.on);
    else if (p.on) { try { navigator.vibrate?.([500, 200, 500, 200, 500]); } catch { /* */ } }
    return true;
  });
  handleRpc('clipboard.get', () => (native ? native.getClipboard() : ''));
}

export function setupPcServices() {
  // Pull the phone's clipboard when PC regains focus and push ours
  window.addEventListener('focus', () => checkLocalClipboard());
  setInterval(() => { if (document.hasFocus()) checkLocalClipboard(); }, 2500);
  bus.addEventListener('notif', (e) => {
    const n = (e as CustomEvent).detail as Notif;
    const s = getState();
    if (!s.settings.browserNotif || n.ongoing) return;
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      try { new Notification(`${n.app}: ${n.title}`, { body: n.text, icon: n.icon || '/icon.svg', tag: n.key }); } catch { /* */ }
    }
  });
  bus.addEventListener('sms', (e) => {
    const m = (e as CustomEvent).detail;
    toast(`SMS: ${m.name || m.address} 「${String(m.body).slice(0, 40)}」`);
  });
}
