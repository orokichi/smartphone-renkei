import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useStore, setSettings, toast, fmtBytes, fmtTime, getState, Notif } from '../lib/store';
import { rpc, sendClip, sendFile, sourceFromFile, send, pairUrl, unpair, bus, isConnected } from '../lib/link';
import { Icon, Switch, SettingRow, TransferList, StatusPill, Loader, Wavy } from './common';

export const APK_URL = 'https://github.com/orokichi/smartphone-renkei/releases/latest';

type Page = 'home' | 'messages' | 'calls' | 'photos' | 'files' | 'clipboard' | 'notifs' | 'settings';
const NAV: { id: Page; icon: string; label: string }[] = [
  { id: 'home', icon: 'smartphone', label: 'ホーム' },
  { id: 'messages', icon: 'sms', label: 'メッセージ' },
  { id: 'calls', icon: 'call', label: '通話' },
  { id: 'photos', icon: 'photo_library', label: '写真' },
  { id: 'files', icon: 'folder_open', label: 'ファイル' },
  { id: 'clipboard', icon: 'content_paste', label: 'クリップ' },
  { id: 'notifs', icon: 'notifications', label: '通知' },
  { id: 'settings', icon: 'settings', label: '設定' },
];

export default function Pc() {
  const status = useStore((s) => s.status);
  const notifCount = useStore((s) => s.notifs.filter((n) => !n.ongoing).length);
  const [page, setPage] = useState<Page>('home');
  const [unreadNotif, setUnreadNotif] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = () => setUnreadNotif((n) => n + 1);
    bus.addEventListener('notif', h);
    return () => bus.removeEventListener('notif', h);
  }, []);
  useEffect(() => { if (page === 'notifs') setUnreadNotif(0); }, [page, notifCount]);

  // global drag & drop → send files
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      if (!isConnected()) return toast('スマートフォンと接続してください');
      Array.from(e.dataTransfer?.files || []).forEach((f) => sendFile(sourceFromFile(f)));
      setPage('files');
    };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);

  const connected = status === 'connected';
  return (
    <div className="pc">
      <nav className="rail">
        <button className="fab" title="ファイルを送信" onClick={() => fileInput.current?.click()} disabled={!connected}><Icon n="upload" fill /></button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { Array.from(e.target.files || []).forEach((f) => sendFile(sourceFromFile(f))); e.target.value = ''; setPage('files'); }} />
        {NAV.map((n) => (
          <button key={n.id} className={`rail-item ${page === n.id ? 'on' : ''}`} onClick={() => setPage(n.id)}>
            <span className="pill">
              <Icon n={n.icon} fill={page === n.id} />
              {n.id === 'notifs' && unreadNotif > 0 && page !== 'notifs' && <span className="badge">{unreadNotif > 99 ? '99+' : unreadNotif}</span>}
            </span>
            <span className="lbl">{n.label}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        {!connected && page !== 'settings' ? <Pair /> :
          page === 'home' ? <Home go={setPage} /> :
          page === 'messages' ? <Messages /> :
          page === 'calls' ? <Calls /> :
          page === 'photos' ? <Photos /> :
          page === 'files' ? <Files /> :
          page === 'clipboard' ? <ClipboardPage /> :
          page === 'notifs' ? <Notifs /> : <SettingsPage />}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------- pairing */

function Pair() {
  const s = useStore((x) => x);
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!s.hostId || !s.pin) return;
    const dark = getComputedStyle(document.documentElement).getPropertyValue('--md-on-primary-container').trim() || '#000';
    QRCode.toDataURL(pairUrl(), { margin: 0, width: 240, color: { dark, light: '#ffffff' }, errorCorrectionLevel: 'M' }).then(setQr);
  }, [s.hostId, s.pin]);
  return (
    <div className="page stagger">
      <div className="page-head"><div className="display">スマートフォン連携</div></div>
      <div className="hero">
        <div className="blob" />
        <div className="row wrap" style={{ gap: 32, alignItems: 'center', position: 'relative' }}>
          <div className="qr">{qr ? <img src={qr} width={240} height={240} alt="ペアリング用QRコード" /> : <div style={{ width: 240, height: 240, display: 'grid', placeItems: 'center' }}><Loader /></div>}</div>
          <div className="col grow" style={{ minWidth: 260 }}>
            <StatusPill />
            <div className="headline">スマホでQRコードを読み取ってください</div>
            <div>スマートフォン連携アプリの「QRコードをスキャン」から読み取るか、コードを入力します。</div>
            <div className="card" style={{ background: 'var(--md-surface-container-lowest)', color: 'var(--md-on-surface)' }}>
              <div className="label muted">ペアリングコード</div>
              <div className="code mono">{s.hostId ? `${s.hostId.toUpperCase()}-${s.pin}` : '······-····'}</div>
            </div>
            {s.error && <div className="card tertiary body-s">{s.error}</div>}
          </div>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <Step n={1} icon="install_mobile" title="アプリを入れる" text="Android に「スマートフォン連携」APK をインストールします。">
          <a className="btn tonal sm" href={APK_URL} target="_blank" rel="noreferrer"><Icon n="download" />APK をダウンロード</a>
        </Step>
        <Step n={2} icon="qr_code_scanner" title="QRを読み取る" text="アプリでスキャンするとPINが自動で入力され、すぐ接続されます。" />
        <Step n={3} icon="verified_user" title="権限を許可" text="通知・SMS・通話履歴・写真などを許可すると、PCから使えるようになります。" />
      </div>
      <div className="body-s muted">通信はWebRTCで端末間を直接暗号化して送ります。ブラウザのタブを開いている間だけ接続できます。</div>
    </div>
  );
}

function Step({ n, icon, title, text, children }: { n: number; icon: string; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="card col">
      <div className="row"><div className="avatar shape-cookie" style={{ background: 'var(--md-secondary-container)', color: 'var(--md-on-secondary-container)' }}><Icon n={icon} /></div><span className="label muted">STEP {n}</span></div>
      <div className="title-l">{title}</div>
      <div className="muted">{text}</div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- home */

function Home({ go }: { go: (p: Page) => void }) {
  const d = useStore((s) => s.device);
  const peer = useStore((s) => s.peerName);
  const notifs = useStore((s) => s.notifs);
  const [ringing, setRinging] = useState(false);
  const [url, setUrl] = useState('');
  const storageUsed = d?.storageTotal ? 1 - (d.storageFree || 0) / d.storageTotal : 0;
  const ring = async () => {
    const on = !ringing;
    try { await rpc('ring', { on }); setRinging(on); toast(on ? 'スマホを鳴らしています' : '停止しました'); } catch (e: any) { toast(e.message); }
  };
  return (
    <div className="page stagger">
      <div className="page-head"><div className="display grow">{peer || 'スマートフォン'}</div><StatusPill /></div>
      <div className="hero">
        <div className="blob" />
        <div className="row wrap" style={{ gap: 36, position: 'relative' }}>
          <div className="stat"><span className="label">バッテリー</span><b>{d?.battery != null ? `${d.battery}%` : '—'}</b><span className="body-s">{d?.charging ? '充電中' : '　'}</span></div>
          <div className="stat"><span className="label">ネットワーク</span><b style={{ fontSize: 22 }}>{d?.network || '—'}</b></div>
          <div className="stat"><span className="label">Android</span><b style={{ fontSize: 22 }}>{d?.android || '—'}</b></div>
          <div className="stat grow" style={{ minWidth: 200 }}>
            <span className="label">ストレージ</span>
            <b style={{ fontSize: 22 }}>{d?.storageTotal ? `${fmtBytes(d.storageFree)} 空き` : '—'}</b>
            {d?.storageTotal ? <Wavy value={storageUsed} active={false} /> : null}
          </div>
        </div>
      </div>
      <div className="quick" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <button className={ringing ? 'tertiary' : 'primary'} onClick={ring}><Icon n={ringing ? 'notifications_off' : 'ring_volume'} fill />{ringing ? '鳴動を止める' : 'スマホを鳴らす'}</button>
        <button className="secondary" onClick={async () => { try { const t = await navigator.clipboard.readText(); sendClip(t) ? toast('クリップボードを送信しました') : toast('送信する内容がありません'); } catch { toast('クリップボードを読み取れません'); } }}><Icon n="content_paste_go" />クリップボードを送る</button>
        <button onClick={() => go('messages')}><Icon n="sms" />メッセージ</button>
        <button onClick={() => go('photos')}><Icon n="photo_library" />最近の写真</button>
      </div>
      <div className="card col">
        <div className="title-m">リンクをスマホで開く</div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (!/^https?:\/\//.test(url)) return toast('http(s):// から始まるURLを入力'); send({ t: 'url', url }); setUrl(''); toast('スマホで開きました'); }}>
          <input className="field grow" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn"><Icon n="send_to_mobile" />送信</button>
        </form>
      </div>
      <div className="card col">
        <div className="row"><div className="title-m grow">最近の通知</div><button className="btn text sm" onClick={() => go('notifs')}>すべて表示</button></div>
        <NotifList items={notifs.filter((n) => !n.ongoing).slice(0, 4)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ messages */

interface Thread { address: string; name?: string; snippet: string; date: number; read?: boolean }
interface Sms { id: string; body: string; date: number; type: number }

function Messages() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [sel, setSel] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Sms[]>([]);
  const [text, setText] = useState('');
  const [newTo, setNewTo] = useState('');
  const [err, setErr] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  const loadThreads = () => rpc<Thread[]>('sms.threads').then(setThreads).catch((e) => { setErr(e.message); setThreads([]); });
  const loadMsgs = (a: string) => rpc<Sms[]>('sms.messages', { address: a }).then((m) => { setMsgs(m); setTimeout(() => scroller.current?.scrollTo(0, 1e9), 30); }).catch((e) => toast(e.message));
  useEffect(() => { loadThreads(); }, []);
  useEffect(() => { if (sel) loadMsgs(sel.address); }, [sel?.address]);
  useEffect(() => {
    const h = (e: Event) => { const m = (e as CustomEvent).detail; loadThreads(); if (sel && m.address && m.address.replace(/\D/g, '').endsWith(sel.address.replace(/\D/g, '').slice(-9))) loadMsgs(sel.address); };
    bus.addEventListener('sms', h); return () => bus.removeEventListener('sms', h);
  }, [sel?.address]);

  const sendSms = async () => {
    const to = sel?.address || newTo.trim();
    if (!to || !text.trim()) return;
    const body = text; setText('');
    setMsgs((m) => [...m, { id: 'tmp' + Date.now(), body, date: Date.now(), type: 2 }]);
    setTimeout(() => scroller.current?.scrollTo(0, 1e9), 30);
    try { await rpc('sms.send', { address: to, text: body }); toast('送信しました'); if (!sel) { setSel({ address: to, snippet: body, date: Date.now() }); } setTimeout(() => { loadThreads(); loadMsgs(to); }, 1500); }
    catch (e: any) { toast(e.message); }
  };

  return (
    <div className="page">
      <div className="page-head"><div className="display grow">メッセージ</div>
        <button className="btn tonal" onClick={() => { setSel(null); setMsgs([]); }}><Icon n="edit" />新規</button>
        <button className="icon-btn" onClick={loadThreads}><Icon n="refresh" /></button>
      </div>
      {err && <div className="card tertiary">{err}（スマホで SMS の権限を許可してください）</div>}
      <div className={`msgs ${sel ? 'has-convo' : ''}`}>
        <div className="thread-list">
          {threads === null ? <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Loader /></div> : (
            <div className="list stagger">
              {threads.map((t) => (
                <div key={t.address} className={`li click ${sel?.address === t.address ? 'sel' : ''}`} onClick={() => setSel(t)}>
                  <div className="avatar">{(t.name || t.address).slice(0, 1)}</div>
                  <div className="grow">
                    <div className="row" style={{ gap: 6 }}><span className="title-m ellipsis grow" style={{ fontWeight: t.read === false ? 800 : 600 }}>{t.name || t.address}</span><span className="body-s muted">{fmtTime(t.date)}</span></div>
                    <div className="body-s muted ellipsis">{t.snippet}</div>
                  </div>
                </div>
              ))}
              {!threads.length && <div className="card outlined muted">メッセージはありません</div>}
            </div>
          )}
        </div>
        <div className="convo">
          <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--md-outline-variant)' }}>
            {sel ? <>
              <button className="icon-btn" onClick={() => setSel(null)}><Icon n="arrow_back" /></button>
              <div className="avatar">{(sel.name || sel.address).slice(0, 1)}</div>
              <div className="grow"><div className="title-m">{sel.name || sel.address}</div><div className="body-s muted">{sel.address}</div></div>
              <button className="icon-btn tonal" title="スマホで発信" onClick={() => rpc('calls.dial', { number: sel.address }).then(() => toast('スマホで発信しました')).catch((e) => toast(e.message))}><Icon n="call" /></button>
            </> : <input className="field" placeholder="宛先の電話番号" value={newTo} onChange={(e) => setNewTo(e.target.value)} />}
          </div>
          <div className="scroll" ref={scroller}>
            {msgs.map((m) => <div key={m.id} className={`bubble ${m.type === 1 ? 'in' : 'out'}`} title={fmtTime(m.date)}>{m.body}</div>)}
            {!msgs.length && <div className="muted" style={{ margin: 'auto' }}>{sel ? '読み込み中…' : '宛先を入力してメッセージを送信'}</div>}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); sendSms(); }}>
            <textarea className="field grow" rows={1} placeholder="SMS を入力" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendSms(); } }} />
            <button className="icon-btn filled" style={{ width: 52, height: 52 }} disabled={!text.trim()}><Icon n="send" fill /></button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- calls */

interface Call { number: string; name?: string; date: number; duration: number; type: number }

function Calls() {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [num, setNum] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { rpc<Call[]>('calls.list').then(setCalls).catch((e) => { setErr(e.message); setCalls([]); }); }, []);
  const dial = (n: string) => rpc('calls.dial', { number: n }).then(() => toast(`${n} にスマホで発信しました`)).catch((e) => toast(e.message));
  const typeIcon = (t: number) => (t === 1 ? 'call_received' : t === 2 ? 'call_made' : t === 3 ? 'call_missed' : 'call');
  return (
    <div className="page">
      <div className="page-head"><div className="display">通話</div></div>
      {err && <div className="card tertiary">{err}（スマホで通話履歴の権限を許可してください）</div>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px', alignItems: 'start' }}>
        <div className="list stagger">
          {calls === null ? <Loader /> : calls.map((c, i) => (
            <div className="li click" key={i} onClick={() => dial(c.number)}>
              <div className="avatar" style={c.type === 3 ? { background: 'var(--md-error-container)', color: 'var(--md-on-error-container)' } : undefined}><Icon n={typeIcon(c.type)} /></div>
              <div className="grow"><div className="title-m">{c.name || c.number}</div><div className="body-s muted">{fmtTime(c.date)}{c.duration ? ` ・ ${Math.floor(c.duration / 60)}分${c.duration % 60}秒` : ''}</div></div>
              <Icon n="call" className="muted" />
            </div>
          ))}
          {calls && !calls.length && !err && <div className="card outlined muted">履歴はありません</div>}
        </div>
        <div className="card col" style={{ alignItems: 'center', position: 'sticky', top: 0 }}>
          <input className="field mono" style={{ textAlign: 'center', fontSize: 24 }} value={num} onChange={(e) => setNum(e.target.value)} placeholder="電話番号" />
          <div className="dial">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((k) => <button key={k} onClick={() => setNum((n) => n + k)}>{k}</button>)}</div>
          <div className="row">
            <button className="icon-btn" onClick={() => setNum((n) => n.slice(0, -1))}><Icon n="backspace" /></button>
            <button className="btn lg" disabled={!num} onClick={() => dial(num)}><Icon n="call" fill />発信</button>
          </div>
          <div className="body-s muted" style={{ textAlign: 'center' }}>スマホから発信されます</div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- photos */

interface Photo { id: string; name: string; date: number; size: number }

function Photos() {
  const [list, setList] = useState<Photo[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    rpc<Photo[]>('photos.list', { limit: 90 }).then(async (l) => {
      if (!alive) return; setList(l);
      for (let i = 0; i < l.length; i += 6) {
        const batch = await Promise.all(l.slice(i, i + 6).map((p) => rpc<string>('photos.thumb', { id: p.id }).catch(() => '')));
        if (!alive) return;
        setThumbs((t) => { const n = { ...t }; batch.forEach((b, j) => { if (b) n[l[i + j].id] = 'data:image/jpeg;base64,' + b; }); return n; });
      }
    }).catch((e) => { setErr(e.message); setList([]); });
    return () => { alive = false; };
  }, []);
  const download = (ids: string[]) => rpc('photos.send', { ids }).then(() => { toast(`${ids.length}枚を受信しています`); setSel([]); }).catch((e) => toast(e.message));
  return (
    <div className="page">
      <div className="page-head"><div className="display grow">写真</div>
        {sel.length > 0 && <><span className="label">{sel.length}枚選択</span><button className="btn text" onClick={() => setSel([])}>解除</button><button className="btn" onClick={() => download(sel)}><Icon n="download" />PCに保存</button></>}
      </div>
      {err && <div className="card tertiary">{err}（スマホで写真の権限を許可してください）</div>}
      {list === null ? <Loader /> : (
        <div className="photos">
          {list.map((p) => {
            const on = sel.includes(p.id);
            return (
              <div key={p.id} className={`ph ${on ? 'sel' : ''}`} title={`${p.name} ・ ${fmtBytes(p.size)}`}
                onClick={() => setSel((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                onDoubleClick={() => download([p.id])}>
                {thumbs[p.id] ? <img src={thumbs[p.id]} alt={p.name} loading="lazy" /> : <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}><Icon n="image" className="muted" /></div>}
                {on && <Icon n="check_circle" fill className="check" />}
              </div>
            );
          })}
        </div>
      )}
      <div className="body-s muted">クリックで選択、ダブルクリックですぐ保存します。</div>
    </div>
  );
}

/* --------------------------------------------------------------- files */

function Files() {
  const transfers = useStore((s) => s.transfers);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="page">
      <div className="page-head"><div className="display">ファイル</div></div>
      <div className={`drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); Array.from(e.dataTransfer.files).forEach((f) => sendFile(sourceFromFile(f))); }}>
        <Icon n="upload_file" size={48} />
        <div className="title-l">ここにファイルをドロップ</div>
        <div className="muted">またはクリックして選択 ・ スマホの「ダウンロード/スマートフォン連携」に保存されます</div>
        <input ref={input} type="file" multiple hidden onChange={(e) => { Array.from(e.target.files || []).forEach((f) => sendFile(sourceFromFile(f))); e.target.value = ''; }} />
      </div>
      <div className="title-m">転送履歴</div>
      <TransferList items={transfers} />
    </div>
  );
}

/* ----------------------------------------------------------- clipboard */

export function ClipboardPage() {
  const clips = useStore((s) => s.clips);
  const auto = useStore((s) => s.settings.autoClip);
  const [text, setText] = useState('');
  return (
    <div className="page">
      <div className="page-head"><div className="display grow">クリップボード</div></div>
      <div className="card row">
        <Icon n="sync" />
        <div className="grow"><div className="title-m">自動同期</div><div className="body-s muted">PCでコピーした内容を、このタブに戻ったときにスマホへ送ります（ブラウザの許可が必要）。</div></div>
        <Switch checked={auto} onChange={(v) => setSettings({ autoClip: v })} />
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (sendClip(text)) { setText(''); toast('送信しました'); } }}>
        <textarea className="field grow" rows={2} placeholder="スマホに送るテキスト" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={!text}><Icon n="send_to_mobile" />送信</button>
      </form>
      <div className="list stagger">
        {clips.map((c, i) => (
          <div className="li" key={i}>
            <Icon n={c.from === 'me' ? 'north_east' : 'south_west'} className="muted" />
            <div className="grow" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'hidden' }}>{c.text}</div>
            <span className="body-s muted">{fmtTime(c.ts)}</span>
            <button className="icon-btn" title="コピー" onClick={() => navigator.clipboard.writeText(c.text).then(() => toast('コピーしました'))}><Icon n="content_copy" /></button>
          </div>
        ))}
        {!clips.length && <div className="card outlined muted">履歴はまだありません</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- notifications */

function NotifList({ items }: { items: Notif[] }) {
  if (!items.length) return <div className="muted body-s">通知はありません</div>;
  return (
    <div className="list stagger">
      {items.map((n) => (
        <div className="li" key={n.key}>
          <div className="avatar shape-cookie">{n.icon ? <img src={n.icon} alt="" /> : (n.app || '?').slice(0, 1)}</div>
          <div className="grow">
            <div className="row" style={{ gap: 6 }}><span className="label muted ellipsis grow">{n.app}</span><span className="body-s muted">{fmtTime(n.time)}</span></div>
            <div className="title-m ellipsis" style={{ fontSize: 15 }}>{n.title}</div>
            {n.text && <div className="body-s" style={{ whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{n.text}</div>}
          </div>
          {!n.ongoing && <button className="icon-btn" title="スマホから消去" onClick={() => send({ t: 'notif-dismiss', key: n.key })}><Icon n="close" /></button>}
        </div>
      ))}
    </div>
  );
}

function Notifs() {
  const notifs = useStore((s) => s.notifs);
  const [showOngoing, setShowOngoing] = useState(false);
  const list = useMemo(() => notifs.filter((n) => showOngoing || !n.ongoing).sort((a, b) => b.time - a.time), [notifs, showOngoing]);
  return (
    <div className="page">
      <div className="page-head"><div className="display grow">通知</div>
        <button className={`chip ${showOngoing ? 'on' : ''}`} onClick={() => setShowOngoing(!showOngoing)}>{showOngoing && <Icon n="check" size={18} />}常駐通知も表示</button>
        <button className="btn tonal sm" onClick={() => list.filter((n) => !n.ongoing).forEach((n) => send({ t: 'notif-dismiss', key: n.key }))}><Icon n="clear_all" />すべて消去</button>
      </div>
      <NotifList items={list} />
    </div>
  );
}

/* ------------------------------------------------------------ settings */

export function ThemeSettings() {
  const st = useStore((s) => s.settings);
  const seeds = ['#1b6b4f', '#6750a4', '#0061a4', '#b3261e', '#8b5000', '#006a6a', '#984061', '#3b6939'];
  return (
    <div className="list">
      <SettingRow icon="palette" title="スマホの壁紙の色に合わせる" desc="接続中のAndroidのダイナミックカラーを使います">
        <Switch checked={st.followPhone} onChange={(v) => setSettings({ followPhone: v })} />
      </SettingRow>
      <div className="li" style={{ flexWrap: 'wrap' }}>
        <Icon n="colors" /><div className="title-m grow">テーマカラー</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {seeds.map((c) => (
            <button key={c} onClick={() => setSettings({ seed: c, followPhone: false })} title={c}
              style={{ width: 36, height: 36, border: 0, cursor: 'pointer', background: c, borderRadius: st.seed === c && !st.followPhone ? 12 : 999, transition: 'border-radius .35s var(--spring)', outline: st.seed === c && !st.followPhone ? '3px solid var(--md-on-surface)' : 'none', outlineOffset: 2 }} />
          ))}
          <input type="color" value={st.seed} onChange={(e) => setSettings({ seed: e.target.value, followPhone: false })} style={{ width: 36, height: 36, border: 0, background: 'none', padding: 0 }} />
        </div>
      </div>
      <div className="li">
        <Icon n="dark_mode" /><div className="title-m grow">外観</div>
        {(['system', 'light', 'dark'] as const).map((m) => (
          <button key={m} className={`chip ${st.dark === m ? 'on' : ''}`} onClick={() => setSettings({ dark: m })}>{m === 'system' ? '自動' : m === 'light' ? 'ライト' : 'ダーク'}</button>
        ))}
      </div>
    </div>
  );
}

function SettingsPage() {
  const st = useStore((s) => s.settings);
  const status = useStore((s) => s.status);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  return (
    <div className="page">
      <div className="page-head"><div className="display">設定</div></div>
      <ThemeSettings />
      <div className="list">
        <SettingRow icon="notifications_active" title="デスクトップ通知" desc={perm === 'granted' ? 'スマホの通知をPCにも表示します' : 'ブラウザの許可が必要です'}>
          {perm === 'granted' ? <Switch checked={st.browserNotif} onChange={(v) => setSettings({ browserNotif: v })} />
            : <button className="btn tonal sm" onClick={() => Notification.requestPermission().then(setPerm)}>許可</button>}
        </SettingRow>
        <SettingRow icon="content_paste" title="クリップボード自動同期"><Switch checked={st.autoClip} onChange={(v) => setSettings({ autoClip: v })} /></SettingRow>
        <SettingRow icon="install_mobile" title="Android アプリ" desc="APK をダウンロード"><a className="btn tonal sm" href={APK_URL} target="_blank" rel="noreferrer">開く</a></SettingRow>
        <SettingRow icon="smartphone" title="このデバイスをスマホ側として使う" desc="スマホのブラウザで使う場合">
          <button className="btn text sm" onClick={() => { setSettings({ roleOverride: 'phone' }); location.reload(); }}>切替</button>
        </SettingRow>
        <SettingRow icon="link_off" title="ペアリングを解除" desc="信頼済みのスマホをすべて削除し、新しいコードを発行します">
          <button className="btn danger sm" onClick={() => { unpair(); toast('解除しました'); }} disabled={status === 'idle'}>解除</button>
        </SettingRow>
      </div>
      <div className="body-s muted">スマートフォン連携 v1.0 ・ PeerJS (WebRTC) ・ Material 3 Expressive</div>
    </div>
  );
}
