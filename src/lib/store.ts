import { useSyncExternalStore } from 'react';

export type Role = 'pc' | 'phone';
export type Status = 'idle' | 'waiting' | 'connecting' | 'connected' | 'error';

export interface DeviceInfo {
  name?: string;
  model?: string;
  android?: string;
  battery?: number;
  charging?: boolean;
  network?: string;
  storageFree?: number;
  storageTotal?: number;
  accent?: string;
  native?: boolean;
}

export interface Clip { text: string; from: 'me' | 'peer'; ts: number }
export interface Transfer {
  id: string; name: string; size: number; mime: string;
  dir: 'in' | 'out'; received: number; status: 'active' | 'done' | 'error';
  url?: string; nativeId?: string; ts: number;
}
export interface Notif {
  key: string; pkg: string; app: string; title: string; text: string;
  time: number; icon?: string; ongoing?: boolean; actions?: string[];
}

export interface Settings {
  autoClip: boolean;
  browserNotif: boolean;
  seed: string;
  followPhone: boolean;
  dark: 'system' | 'light' | 'dark';
  roleOverride?: Role | null;
}

export interface State {
  role: Role;
  status: Status;
  error?: string;
  hostId?: string;
  pin?: string;
  peerName?: string;
  device: DeviceInfo | null;
  clips: Clip[];
  transfers: Transfer[];
  notifs: Notif[];
  settings: Settings;
  toast?: { text: string; action?: string; onAction?: () => void; id: number } | null;
}

const SETTINGS_KEY = 'sr.settings';
const defaults: Settings = { autoClip: true, browserNotif: true, seed: '#1b6b4f', followPhone: true, dark: 'system', roleOverride: null };

function loadSettings(): Settings {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return defaults; }
}

const isNative = typeof (window as any).Android !== 'undefined';
const mobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const settings0 = loadSettings();

let state: State = {
  role: settings0.roleOverride || (isNative || mobileUA ? 'phone' : 'pc'),
  status: 'idle',
  device: null,
  clips: [],
  transfers: [],
  notifs: [],
  settings: settings0,
  toast: null,
};

const listeners = new Set<() => void>();

export function getState() { return state; }

export function setState(p: Partial<State> | ((s: State) => Partial<State>)) {
  const patch = typeof p === 'function' ? p(state) : p;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function setSettings(p: Partial<Settings>) {
  const s = { ...state.settings, ...p };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  setState({ settings: s });
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => sel(state),
  );
}

let toastId = 0;
export function toast(text: string, action?: string, onAction?: () => void) {
  const id = ++toastId;
  setState({ toast: { text, action, onAction, id } });
  setTimeout(() => { if (state.toast?.id === id) setState({ toast: null }); }, 4500);
}

export function fmtBytes(n?: number) {
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i < 2 ? 0 : 1)} ${u[i]}`;
}

export function fmtTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
