/**
 * MapCanvas — neutral SVG backdrop rendered when no Google Maps key is set.
 *
 * Pins are placed in the same 0..100 viewBox space the real map uses, so
 * swapping VITE_GOOGLE_MAPS_KEY in doesn't change layout math.
 */
export interface MapPin {
  x: number;
  y: number;
  label: string;
  primary?: boolean;
}

interface Props {
  pins?: MapPin[];
}

export default function MapCanvas({ pins = [] }: Props) {
  return (
    <svg
      className="map-canvas"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="land" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#F4EEDF" />
          <stop offset="1" stopColor="#EDE4CC" />
        </linearGradient>
      </defs>

      <rect width="100" height="100" fill="url(#land)" />

      {/* Light grid — purely visual, no labels */}
      <g stroke="#E8DEC4" strokeWidth="0.4" opacity="0.6">
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={`h${i}`} x1="0" x2="100" y1={4 + i * 8} y2={4 + i * 8} />
        ))}
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={`v${i}`} y1="0" y2="100" x1={4 + i * 8} x2={4 + i * 8} />
        ))}
      </g>

      {/* Pins */}
      {pins.map((p, i) => (
        <g key={i} transform={`translate(${p.x}, ${p.y})`}>
          {p.primary && (
            <circle r="1" fill="none" stroke="#A672E0" strokeWidth="0.6" opacity="0.5">
              <animate attributeName="r" from="1" to="5" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite" />
            </circle>
          )}
          <circle r="1.5" fill={p.primary ? "#A672E0" : "#0E1116"} stroke="#FBF7EE" strokeWidth="0.4" />
        </g>
      ))}
    </svg>
  );
}
