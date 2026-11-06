import { useColorScheme } from 'react-native';

// onAccent pairs with accent and flips per theme. Never hardcode white on
// t.accent: the dark accent is a light periwinkle and white on it is 2.4:1.
const light = {
  paper: '#F3F4F0', surface: '#FFFFFF', surface2: '#EAECE6',
  ink: '#141A26', ink2: '#4A5468', ink3: '#5C6679',
  rule: '#D8DBD3', accent: '#2E3F91', accentSoft: '#E3E6F5', onAccent: '#FFFFFF',
  flag: '#A33A0A', flagSoft: '#F8E5DB',
  ok: '#2C6E49', warn: '#8A5A08', risk: '#A82A20',
  okSoft: '#DFEBE2', warnSoft: '#F5EAD5', riskSoft: '#F6DFDC',
  // quiet, not disabled: "we don't know yet" must not read as "fine" OR as greyed out
  unknown: '#4A5468', unknownSoft: '#EAECE6',
};
// Cards were barely distinguishable from the ground in dark mode (a review
// finding): surface and rule are a step lighter than they were.
const dark: typeof light = {
  paper: '#0D1017', surface: '#171C26', surface2: '#1F2531',
  ink: '#E7EAE3', ink2: '#AEB6C6', ink3: '#8B96AB',
  rule: '#2E3644', accent: '#93A2F2', accentSoft: '#1C2340', onAccent: '#0D1017',
  flag: '#F0813F', flagSoft: '#33200F',
  ok: '#6EC08D', warn: '#D9A33F', risk: '#EE8577',
  okSoft: '#152A1E', warnSoft: '#2C2311', riskSoft: '#301917',
  unknown: '#AEB6C6', unknownSoft: '#1F2531',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

// One type scale. There were six sizes between 10 and 15 on a single screen;
// these five are the only ones the app uses.
export const type = {
  caption: 12,   // chips, eyebrows, citations, footnotes — never smaller
  body: 15,      // secondary lines
  bodyLg: 17,    // reading text: findings, list rows (the iOS body size)
  title: 22,     // screen and card titles
  display: 28,   // the headline finding
} as const;

export const radius = { chip: 6, card: 14, button: 12 } as const;

// The minimum tappable edge, per Apple HIG and Material alike.
export const TOUCH = 44;

// Regulatory status drives colour. Semantic, never decorative.
export function statusTone(t: Theme, status: string, pending: boolean) {
  if (pending) return { fg: t.warn, bg: t.warnSoft, label: 'PENDING BAN' };
  switch (status) {
    case 'banned':
    case 'not_authorised':   return { fg: t.risk, bg: t.riskSoft, label: 'BANNED' };
    case 'warning_required': return { fg: t.warn, bg: t.warnSoft, label: 'WARNING LABEL' };
    case 'restricted':       return { fg: t.warn, bg: t.warnSoft, label: 'RESTRICTED' };
    default:                 return { fg: t.ok,   bg: t.okSoft,   label: 'PERMITTED' };
  }
}

// Status severity for sorting summaries: in-force bans first.
export function statusRank(status: string, pending: boolean) {
  if (status === 'banned' || status === 'not_authorised') return pending ? 1 : 0;
  if (status === 'warning_required') return 2;
  if (status === 'restricted') return 3;
  return 9;
}
