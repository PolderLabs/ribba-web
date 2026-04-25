import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/app-links';

type BadgeProps = {
  height?: number;
};

export function AppStoreBadge({ height = 44 }: BadgeProps) {
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Download in de App Store"
      style={{ display: 'inline-flex', lineHeight: 0 }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 135 40"
        height={height}
        width={(135 / 40) * height}
        role="img"
        aria-hidden="true"
      >
        <rect width="135" height="40" rx="6" ry="6" fill="#000" />
        <rect
          x="0.5"
          y="0.5"
          width="134"
          height="39"
          rx="5.5"
          ry="5.5"
          fill="none"
          stroke="#A6A6A6"
          strokeWidth="1"
        />
        {/* Apple glyph */}
        <g fill="#fff" transform="translate(11 8.5)">
          <path d="M13.43 11.83c-.02-2.24 1.83-3.32 1.92-3.37-1.05-1.53-2.68-1.74-3.26-1.77-1.39-.14-2.71.82-3.41.82-.71 0-1.79-.8-2.94-.78-1.51.02-2.91.88-3.69 2.23-1.57 2.73-.4 6.76 1.13 8.98.75 1.09 1.64 2.3 2.8 2.26 1.13-.05 1.56-.73 2.93-.73 1.37 0 1.75.73 2.95.71 1.22-.02 1.99-1.1 2.74-2.19.86-1.26 1.22-2.48 1.24-2.55-.03-.01-2.38-.91-2.41-3.61zM11.1 5.36c.62-.76 1.04-1.8.93-2.85-.9.04-1.99.6-2.64 1.35-.58.67-1.09 1.75-.95 2.77 1.01.08 2.04-.51 2.66-1.27z" />
        </g>
        {/* "Download on the" */}
        <text
          x="36"
          y="15"
          fill="#fff"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontSize="8"
          letterSpacing="0.05"
        >
          Download on the
        </text>
        {/* "App Store" */}
        <text
          x="36"
          y="30"
          fill="#fff"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontSize="17"
          fontWeight="600"
          letterSpacing="-0.3"
        >
          App Store
        </text>
      </svg>
    </a>
  );
}

export function GooglePlayBadge({ height = 44 }: BadgeProps) {
  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Ontdek in Google Play"
      style={{ display: 'inline-flex', lineHeight: 0 }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 135 40"
        height={height}
        width={(135 / 40) * height}
        role="img"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="playA" x1="10.4" y1="10.2" x2="18.6" y2="18.4" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#00A0FF" />
            <stop offset="0.26" stopColor="#00A1FF" />
            <stop offset="0.51" stopColor="#00BEFF" />
            <stop offset="0.76" stopColor="#00D2FF" />
            <stop offset="1" stopColor="#00DFFF" />
          </linearGradient>
          <linearGradient id="playB" x1="23.9" y1="20" x2="10" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFE000" />
            <stop offset="0.41" stopColor="#FFBD00" />
            <stop offset="0.78" stopColor="#FFA500" />
            <stop offset="1" stopColor="#FF9C00" />
          </linearGradient>
          <linearGradient id="playC" x1="19.5" y1="22" x2="7.8" y2="33.7" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FF3A44" />
            <stop offset="1" stopColor="#C31162" />
          </linearGradient>
          <linearGradient id="playD" x1="9.3" y1="7.8" x2="15.5" y2="14" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#32A071" />
            <stop offset="0.07" stopColor="#2DA771" />
            <stop offset="0.48" stopColor="#15CF74" />
            <stop offset="0.8" stopColor="#06E775" />
            <stop offset="1" stopColor="#00F076" />
          </linearGradient>
        </defs>
        <rect width="135" height="40" rx="6" ry="6" fill="#000" />
        <rect
          x="0.5"
          y="0.5"
          width="134"
          height="39"
          rx="5.5"
          ry="5.5"
          fill="none"
          stroke="#A6A6A6"
          strokeWidth="1"
        />
        {/* Google Play triangle */}
        <g transform="translate(10.5 9)">
          <path
            d="M0.4 0.5C0.15 0.77 0 1.18 0 1.71v18.58c0 .53.15.94.4 1.21l.06.06 10.41-10.41v-.24L.46.44.4.5z"
            fill="url(#playA)"
          />
          <path
            d="M14.34 15.62l-3.47-3.47v-.24l3.47-3.47.08.04 4.11 2.33c1.17.67 1.17 1.76 0 2.43l-4.11 2.33-.08.05z"
            fill="url(#playB)"
          />
          <path
            d="M14.42 15.58l-3.55-3.55L.4 22.5c.38.41 1.02.46 1.74.05l12.28-6.97"
            fill="url(#playC)"
          />
          <path
            d="M14.42 8.48L2.14 1.51C1.42 1.1.78 1.15.4 1.56l10.47 10.47 3.55-3.55z"
            fill="url(#playD)"
          />
        </g>
        {/* "GET IT ON" */}
        <text
          x="38"
          y="14"
          fill="#fff"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontSize="7"
          letterSpacing="0.3"
        >
          GET IT ON
        </text>
        {/* "Google Play" */}
        <text
          x="38"
          y="29"
          fill="#fff"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontSize="15"
          fontWeight="600"
          letterSpacing="-0.2"
        >
          Google Play
        </text>
      </svg>
    </a>
  );
}

export function StoreBadges({ height = 44 }: BadgeProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        justifyContent: 'center',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <AppStoreBadge height={height} />
      <GooglePlayBadge height={height} />
    </div>
  );
}
