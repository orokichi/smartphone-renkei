import { ReactNode } from 'react';
import { useStore, setState, fmtBytes, Transfer } from '../lib/store';
import { native } from '../lib/native';

export const Icon = ({ n, fill, size, className = '' }: { n: string; fill?: boolean; size?: number; className?: string }) => (
  <span className={`ms ${fill ? 'fill' : ''} ${className}`} style={size ? { fontSize: size } : undefined} aria-hidden>{n}</span>
);

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
    </label>
  );
}

export function SettingRow({ icon, title, desc, children }: { icon: string; title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="li">
      <Icon n={icon} />
      <div className="grow">
        <div className="title-m">{title}</div>
        {desc && <div className="body-s muted">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** M3 Expressive wavy linear progress */
export function Wavy({ value, active = true }: { value: number; active?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  const W = 1000;
  const amp = active && v < 1 ? 3 : 0;
  let d = 'M0 7';
  for (let x = 0; x <= W + 24; x += 6) d += ` L${x} ${7 + amp * Math.sin((x / 24) * Math.PI * 2)}`;
  return (
    <svg className={`wavy ${active && v < 1 ? 'anim' : ''}`} viewBox={`0 0 ${W} 14`} preserveAspectRatio="none">
      <defs><clipPath id={`c${Math.round(v * 1000)}`}><rect x="0" y="-4" width={W * v} height="22" /></clipPath></defs>
      <line className="track" x1={Math.min(W, W * v + 14)} y1="7" x2={W} y2="7" strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <g clipPath={`url(#c${Math.round(v * 1000)})`}>
        <path className="ind wave" d={d} fill="none" strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

export const Loader = ({ size = 48 }: { size?: number }) => <div className="loader" style={{ width: size, height: size }} />;

export function Snackbar() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return (
    <div className="snack" key={t.id} role="status">
      <span className="grow">{t.text}</span>
      {t.action && <button className="btn text" onClick={() => { t.onAction?.(); setState({ toast: null }); }}>{t.action}</button>}
      <button className="icon-btn" style={{ width: 36, height: 36, color: 'inherit' }} onClick={() => setState({ toast: null })}><Icon n="close" size={20} /></button>
    </div>
  );
}

const fileIcon = (mime: string, name: string) =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'movie' : mime.startsWith('audio/') ? 'music_note'
    : /\.(zip|rar|7z|gz)$/i.test(name) ? 'folder_zip' : /\.apk$/i.test(name) ? 'android' : mime.includes('pdf') ? 'picture_as_pdf' : 'description';

export function TransferList({ items }: { items: Transfer[] }) {
  if (!items.length) return <div className="card outlined muted" style={{ textAlign: 'center' }}>まだ転送はありません</div>;
  return (
    <div className="list">
      {items.map((t) => (
        <div className="li" key={t.id}>
          <div className="avatar" style={{ borderRadius: 14 }}><Icon n={fileIcon(t.mime || '', t.name)} /></div>
          <div className="grow col" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 6 }}>
              <Icon n={t.dir === 'in' ? 'south_west' : 'north_east'} size={18} className="muted" />
              <span className="ellipsis title-m" style={{ fontSize: 15 }}>{t.name}</span>
            </div>
            {t.status === 'active' ? <Wavy value={t.size ? t.received / t.size : 0} /> : null}
            <div className="body-s muted">
              {t.status === 'error' ? '失敗しました' : t.status === 'done' ? `${fmtBytes(t.size)} ・ 完了` : `${fmtBytes(t.received)} / ${fmtBytes(t.size)}`}
            </div>
          </div>
          {t.status === 'done' && t.dir === 'in' && t.url && (
            <a className="icon-btn tonal" href={t.url} download={t.name} title="保存"><Icon n="download" /></a>
          )}
          {t.status === 'done' && t.dir === 'in' && t.nativeId && native && (
            <button className="icon-btn tonal" onClick={() => native!.openSaved(t.nativeId!)} title="開く"><Icon n="open_in_new" /></button>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatusPill() {
  const status = useStore((s) => s.status);
  const peer = useStore((s) => s.peerName);
  const label = status === 'connected' ? `${peer || '相手'} と接続中` : status === 'waiting' ? '接続を待っています' : status === 'connecting' ? '接続しています…' : status === 'error' ? 'エラー' : '未接続';
  return (
    <span className="chip on" style={{ background: status === 'connected' ? 'var(--md-primary-container)' : undefined, color: status === 'connected' ? 'var(--md-on-primary-container)' : undefined }}>
      {status === 'connected' ? <Icon n="link" size={18} /> : <span className="pulse-dot" />}
      {label}
    </span>
  );
}
