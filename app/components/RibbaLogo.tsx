export default function RibbaLogo({ height = 40 }: { height?: number }) {
  const width = height * 3.6;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 180 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Ribba"
    >
      {/* Pink ID-card / speech bubble icon, tilted ~-10° */}
      <g transform="translate(26,25) rotate(-10) translate(-26,-23)">
        {/* Main card body */}
        <rect x="0" y="0" width="52" height="40" rx="9" fill="#E8468C" />
        {/* Speech-bubble tail, bottom-left */}
        <path d="M3 40 L3 49 L16 40 Z" fill="#E8468C" />
        {/* Circle (avatar) */}
        <circle cx="17" cy="20" r="8" fill="white" />
        {/* Name bars */}
        <rect x="30" y="14" width="16" height="4" rx="2" fill="white" />
        <rect x="30" y="22" width="11" height="4" rx="2" fill="white" />
      </g>

      {/* RIBBA wordmark */}
      <text
        x="64"
        y="38"
        fontFamily="'Arial Black', 'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize="34"
        fill="#1A35D4"
        letterSpacing="-0.5"
      >
        RIBBA
      </text>
    </svg>
  );
}
