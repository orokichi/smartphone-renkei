import { useEffect, useRef, useState } from 'react';
import { useStore, setSettings, toast, fmtTime } from '../lib/store';
import { native, nativeJson, onNative } from '../lib/native';
import { startClient, getPairing, unpair, sendClip, sendFile, sourceFromFile, checkLocalClipboard, stop } from '../lib/link';
import { Icon, Switch, SettingRow, TransferList, StatusPill, Loader } from './common';
import { ThemeSettings } from './Pc';

type Tab = 'home' | 'transfer' | 'settings';

export function parsePair(text: string): { id: string; pin: string } | null {
  const t = text.trim();
  let m = t.match(/[?&]pair=([a-z0-9]{6})\.(\d{4})/i);
  if (m) return { id: m[1].toLowerCase(), pin: m[2] };
  m = t.replace(/\s/g, '').match(/^([a-z0-9]{6})-?(\d{4})$/i);
  if (m) return { id: m[1].toLowerCase(), pin: m[2] };
  return null;
}

export default function Phone() {
  const status = useStore((s) => s.status);
  const [tab, setTab] = useState<Tab>('home');
  const paired = !!getPairing();
  const showPair = !paired && status !== 'connected' && status !== 'connecting';
  return (
    <div className={showPair ? '' : 'has-bottom-nav'} style={{ minHeight: '100%' }}>
      {showPair ? <PhonePair /> : (
        <>
          <div className="phone">
            {tab === 'home' ? <PhoneHome go={setTab} /> : tab === 'transfer' ? <PhoneTransfer /> : <PhoneSettings />}
          </div>
          <nav className="navbar">
            {([['home', 'home', 'ホーム'], ['transfer', 'swap_vert', '転送'], ['settings', 'settings', '設定']] as const).map(([id, icon, label]) => (
              <button key={id} className={`nav-item ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                <span className="pill"><Icon n={icon} fill={tab === id} /></span><span className="lbl">{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

function PhonePair() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const [code, setCode] = useState('');
  useEffect(() => onNative('qr', (text: string) => {
    const p = parsePair(String(text));
    if (p) startClient(p.id, p.pin); else toast('スマートフォン連携のQRコードではありません');
  }), []);
  const go = () => { const p = parsePair(code); if (!p) return toast('コードは「ABC123-1234」の形式です'); startClient(p.id, p.pin); };
  return (
    <div className="phone stagger" style={{ paddingBottom: 32 }}>
      <div style={{ height: 24 }} />
      <div className="hero" style={{ padding: 28 }}>
        <div className="blob" />
        <div className="col" style={{ position: 'relative', gap: 14 }}>
          <Icon n="devices" size={44} />
          <div className="display" style={{ fontSize: 36 }}>スマートフォン連携</div>
          <div>PCのブラウザで連携ページを開き、表示されたQRコードを読み取ります。</div>
          <div className="mono body-s" style={{ opacity: .85 }}>{location.host}</div>
        </div>
      </div>
      {native && <button className="btn lg" onClick={() => native!.scanQr()}><Icon n="qr_code_scanner" />QRコードをスキャン</button>}
      <div className="card col">
        <div className="title-m">コードを入力</div>
        <input className="field mono" style={{ fontSize: 22, letterSpacing: '.1em', textTransform: 'uppercase' }} placeholder="ABC123-1234" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
        <button className="btn tonal" onClick={go}><Icon n="link" />接続</button>
      </div>
      {status === 'connecting' && <div className="row card"><Loader size={32} /><span>接続しています…</span></div>}
      {error && <div className="card tertiary body-s">{error}</div>}
      {!native && <div className="body-s muted">ブラウザ版はファイル・クリップボードのみ対応です。通知・SMS・通話・写真は Android アプリをご利用ください。</div>}
    </div>
  );
}

function PhoneHome({ go }: { go: (t: Tab) => void }) {
  const status = useStore((s) => s.status);
  const peer = useStore((s) => s.peerName);
  const error = useStore((s) => s.error);
  const clips = useStore((s) => s.clips);
  const fileInput = useRef<HTMLInputElement>(null);
  const pairing = getPairing();
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const refreshPerms = () => native && setPerms(nativeJson(() => native!.permissions(), {}));
  useEffect(() => { refreshPerms(); return onNative('resume', refreshPerms); }, []);
  const missing = Object.values(perms).filter((v) => !v).length;
  const connected = status === 'connected';

  return (
    <>
      <div className="row"><div className="headline grow">スマートフォン連携</div><StatusPill /></div>
      <div className="hero">
        <div className="blob" />
        <div className="col" style={{ position: 'relative', gap: 6 }}>
          <Icon n={connected ? 'computer' : 'portable_wifi_off'} size={40} />
          <div className="label">{connected ? '接続中のPC' : '再接続を待っています'}</div>
          <div className="display" style={{ fontSize: 30 }}>{peer || pairing?.hostName || 'PC'}</div>
          {!connected && <div className="body-s">{error || 'PCでスマートフォン連携のページを開くと自動で接続します。'}</div>}
        </div>
      </div>
      <div className="quick">
        <button className="primary" disabled={!connected} onClick={() => (native ? native.pickFiles() : fileInput.current?.click())}><Icon n="upload_file" fill />ファイルを送る</button>
        <button className="secondary" disabled={!connected} onClick={() => {
          const t = native ? native.getClipboard() : '';
          if (t) { sendClip(t); toast('クリップボードを送信しました'); }
          else navigator.clipboard?.readText().then((x) => { if (sendClip(x)) toast('送信しました'); }).catch(() => toast('クリップボードが空です'));
        }}><Icon n="content_paste_go" />クリップボードを送る</button>
        <button className="tertiary" onClick={() => go('transfer')}><Icon n="swap_vert" />転送履歴</button>
        <button onClick={() => (connected ? stop() : startClient())}><Icon n={connected ? 'link_off' : 'sync'} />{connected ? '切断' : '再接続'}</button>
      </div>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { Array.from(e.target.files || []).forEach((f) => sendFile(sourceFromFile(f))); e.target.value = ''; }} />
      {native && missing > 0 && (
        <div className="card tertiary col">
          <div className="row"><Icon n="shield" /><div className="title-m grow">権限を許可すると機能が増えます</div></div>
          <div className="body-s">{missing}件の権限が未許可です。</div>
          <button className="btn sm" onClick={() => go('settings')}>設定を開く</button>
        </div>
      )}
      {clips.length > 0 && (
        <div className="card col">
          <div className="title-m">最近のクリップボード</div>
          <div className="list">
            {clips.slice(0, 3).map((c, i) => (
              <div className="li" key={i} style={{ background: 'var(--md-surface-container)' }}>
                <Icon n={c.from === 'me' ? 'north_east' : 'south_west'} className="muted" />
                <div className="grow ellipsis">{c.text}</div><span className="body-s muted">{fmtTime(c.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PhoneTransfer() {
  const transfers = useStore((s) => s.transfers);
  return (
    <>
      <div className="headline">転送</div>
      <div className="body-s muted">他のアプリの「共有」から「スマートフォン連携」を選ぶと、PCにすぐ送れます。受信したファイルは「ダウンロード/スマートフォン連携」に保存されます。</div>
      <TransferList items={transfers} />
    </>
  );
}

const PERMS: { key: string; icon: string; title: string; desc: string }[] = [
  { key: 'notificationListener', icon: 'notifications', title: '通知へのアクセス', desc: 'スマホの通知をPCに表示' },
  { key: 'sms', icon: 'sms', title: 'SMS', desc: 'PCでSMSを読む・送る' },
  { key: 'contacts', icon: 'contacts', title: '連絡先', desc: 'メッセージ・通話に名前を表示' },
  { key: 'callLog', icon: 'call_log', title: '通話履歴・発信', desc: 'PCから履歴を見て発信' },
  { key: 'photos', icon: 'photo_library', title: '写真と動画', desc: 'PCで最近の写真を表示・保存' },
  { key: 'postNotifications', icon: 'notifications_active', title: '通知の表示', desc: 'バックグラウンド接続を維持' },
  { key: 'battery', icon: 'battery_saver', title: '電池の最適化を除外', desc: '接続が切れにくくなります' },
];

function PhoneSettings() {
  const st = useStore((s) => s.settings);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const refresh = () => native && setPerms(nativeJson(() => native!.permissions(), {}));
  useEffect(() => { refresh(); const a = onNative('resume', refresh); const b = onNative('permissions', refresh); return () => { a(); b(); }; }, []);
  return (
    <>
      <div className="headline">設定</div>
      {native && (
        <>
          <div className="title-m">権限</div>
          <div className="list">
            {PERMS.map((p) => (
              <SettingRow key={p.key} icon={p.icon} title={p.title} desc={p.desc}>
                {perms[p.key] ? <Icon n="check_circle" fill className="" /> : <button className="btn tonal sm" onClick={() => native!.requestPermission(p.key)}>許可</button>}
              </SettingRow>
            ))}
          </div>
        </>
      )}
      <div className="title-m">同期</div>
      <div className="list">
        <SettingRow icon="content_paste" title="クリップボード自動同期" desc="アプリを開いたときにコピー内容をPCへ送信">
          <Switch checked={st.autoClip} onChange={(v) => { setSettings({ autoClip: v }); if (v) checkLocalClipboard(); }} />
        </SettingRow>
      </div>
      <div className="title-m">テーマ</div>
      <ThemeSettings />
      <div className="list">
        <SettingRow icon="link_off" title="ペアリングを解除">
          <button className="btn danger sm" onClick={() => { unpair(); toast('解除しました'); }}>解除</button>
        </SettingRow>
        {!native && <SettingRow icon="computer" title="このデバイスをPC側として使う"><button className="btn text sm" onClick={() => { setSettings({ roleOverride: 'pc' }); location.reload(); }}>切替</button></SettingRow>}
      </div>
      <div className="body-s muted">スマートフォン連携 v1.0</div>
    </>
  );
}
