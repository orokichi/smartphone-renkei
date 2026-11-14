import { argbFromHex, hexFromArgb, themeFromSourceColor, Scheme } from '@material/material-color-utilities';

const KEYS: (keyof ReturnType<Scheme['toJSON']>)[] = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'background', 'onBackground', 'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant',
  'outline', 'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'inversePrimary',
];

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

export function applyTheme(seed: string, dark: boolean) {
  let theme;
  try { theme = themeFromSourceColor(argbFromHex(seed)); } catch { theme = themeFromSourceColor(argbFromHex('#1b6b4f')); }
  const scheme = dark ? theme.schemes.dark : theme.schemes.light;
  const json = scheme.toJSON() as Record<string, number>;
  const root = document.documentElement;
  for (const k of KEYS) root.style.setProperty(`--md-${kebab(k as string)}`, hexFromArgb(json[k as string]));
  // Surface container tones from the neutral palette
  const n = theme.palettes.neutral;
  const tones = dark
    ? { lowest: 4, low: 10, base: 12, high: 17, highest: 22, dim: 6, bright: 24 }
    : { lowest: 100, low: 96, base: 94, high: 92, highest: 90, dim: 87, bright: 98 };
  root.style.setProperty('--md-surface-container-lowest', hexFromArgb(n.tone(tones.lowest)));
  root.style.setProperty('--md-surface-container-low', hexFromArgb(n.tone(tones.low)));
  root.style.setProperty('--md-surface-container', hexFromArgb(n.tone(tones.base)));
  root.style.setProperty('--md-surface-container-high', hexFromArgb(n.tone(tones.high)));
  root.style.setProperty('--md-surface-container-highest', hexFromArgb(n.tone(tones.highest)));
  root.style.setProperty('--md-surface-dim', hexFromArgb(n.tone(tones.dim)));
  root.style.setProperty('--md-surface-bright', hexFromArgb(n.tone(tones.bright)));
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', hexFromArgb(n.tone(dark ? 6 : 98)));
}
