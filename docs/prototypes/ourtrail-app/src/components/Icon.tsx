export type IconName =
  | 'activity' | 'bell' | 'person' | 'pin' | 'car' | 'check' | 'route'
  | 'cloud' | 'shield' | 'search' | 'plus' | 'back' | 'arrow' | 'more'
  | 'close' | 'copy' | 'users' | 'clock' | 'edit' | 'home' | 'alert'
  | 'download' | 'settings';

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

const paths: Record<IconName, string> = {
  activity: 'M5 5h14v16H5zM8 3v4M16 3v4M5 10h14M8 14h3M8 17h7',
  bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a7 7 0 0 1 14 0v2',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  car: 'M4 16V8l2-4h12l2 4v8H4ZM4 10h16M7 13h1M16 13h1M6 16v4M18 16v4',
  check: 'm5 12 4 4L19 6',
  route: 'M6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM18 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM8 5h6a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h6',
  cloud: 'M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0-1 10Z',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6',
  plus: 'M12 4v16M4 12h16',
  back: 'm14 5-7 7 7 7',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  more: 'M5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM12 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM19 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
  close: 'm6 6 12 12M6 18 18 6',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  users: 'M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6M19 14a5 5 0 0 1 3 4v3',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  edit: 'm14 5 5 5M4 16 16 4a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L8 20l-5 1zM13 21h8',
  home: 'm3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10',
  alert: 'M10.3 4.5a2 2 0 0 1 3.4 0l7 12A2 2 0 0 1 19 20H5a2 2 0 0 1-1.7-3.5zM12 9v4M12 16v.2',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  settings: 'M10 3h4l.6 2.5 2 .9L19 5l2 3.5-1.9 1.7v2.6l1.9 1.7-2 3.5-2.4-1.4-2 .9L14 21h-4l-.6-3.5-2-.9L5 18l-2-3.5 1.9-1.7v-2.6L3 8.5 5 5l2.4 1.4 2-.9zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
};

export function Icon({ name, size = 22, className }: IconProps) {
  return (
    <svg className={['icon', className].filter(Boolean).join(' ')} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}

export function TrailMark({ className }: { className?: string }) {
  return (
    <svg className={['trail-mark', className].filter(Boolean).join(' ')} width="32" height="36" viewBox="0 0 32 36" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M8 3v15c0 5 4 6 8 6s8 2 8 6v3" />
      <path d="M24 3v8c0 5-4 6-8 6S8 19 8 24v9" />
    </svg>
  );
}

export function TrailArt({ className }: { className?: string }) {
  return (
    <svg className={['trail-art', className].filter(Boolean).join(' ')} viewBox="0 0 200 240" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M135-20C40 31 220 51 126 107S35 179 132 260" strokeWidth="2" />
      <path d="M183-20C88 31 164 78 84 123S92 201 179 260" strokeWidth="1.25" />
    </svg>
  );
}
