import { useEffect, useState } from 'react';
import { useStore, setState, getState } from './lib/store';
import { applyTheme } from './lib/theme';
import { native, nativeJson } from './lib/native';
import { startHost, startClient, getPairing, setupPcServices, setupPhoneServices } from './lib/link';
import { Snackbar } from './ui/common';
import Pc from './ui/Pc';
import Phone, { parsePair } from './ui/Phone';

function useDark(mode: 'system' | 'light' | 'dark') {
  const [sys, setSys] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const h = () => setSys(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return mode === 'system' ? sys : mode === 'dark';
}

let booted = false;
function boot() {
  if (booted) return; booted = true;
  const s = getState();
  if (s.role === 'pc') {
    setupPcServices();
    startHost();
  } else {
    setupPhoneServices();
    const p = parsePair(location.href);
    if (p) { history.replaceState(null, '', location.pathname + (native ? '?native=1' : '')); startClient(p.id, p.pin); }
    else if (getPairing()) startClient();
  }
}

export default function App() {
  const role = useStore((s) => s.role);
  const settings = useStore((s) => s.settings);
  const device = useStore((s) => s.device);
  const dark = useDark(settings.dark);

  useEffect(() => { boot(); }, []);

  // Dynamic color: phone uses its own wallpaper accent; PC can follow the connected phone
  const nativeAccent = native ? nativeJson<{ accent?: string }>(() => native!.getInfo(), {}).accent : undefined;
  const seed = role === 'phone'
    ? (settings.followPhone && nativeAccent ? nativeAccent : settings.seed)
    : (settings.followPhone && device?.accent ? device.accent : settings.seed);
  useEffect(() => { applyTheme(seed, dark); }, [seed, dark]);

  return (
    <>
      {role === 'pc' ? <Pc /> : <Phone />}
      <Snackbar />
    </>
  );
}

export { setState };
