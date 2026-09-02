import React, { useState } from 'react';

export interface RatingDistributionSlice {
  label: string;
  value: number;
  color: string;
}

interface RatingDistributionChartProps {
  slices: RatingDistributionSlice[];
  // Center label — a quality score (points earned / points possible for the
  // ratings given so far), not a completion count. Caller computes and
  // formats this (see EvaluationSummary/computeRatingSummary) — a plain
  // string rather than a number+hardcoded "%" so a caller applying a weight
  // (e.g. "64/80") isn't forced into percentage formatting.
  centerLabel: string;
  size?: number;
}

// Small donut built from stacked SVG circles (stroke-dasharray trick) rather
// than a charting library — no chart library is installed in this project,
// and three fixed segments doesn't justify adding one. A 2px surface-color
// gap between segments (shortening each segment's dash length) stands in for
// a border, per this app's chart conventions: never draw a stroke around a
// mark to separate it. Deliberately just the ring + center label — the
// legend is a separate, differently-laid-out concern the caller (see
// EvaluationSummary) renders below it.
const RatingDistributionChart: React.FC<RatingDistributionChartProps> = ({ slices, centerLabel, size = 128 }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const answered = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = size / 2;
  const baseStrokeWidth = size * 0.22;
  const innerRadius = radius - baseStrokeWidth / 2;
  const circumference = 2 * Math.PI * innerRadius;
  const gapPx = answered > 1 ? 3 : 0;

  let cumulativeLength = 0;
  const segments = slices
    .filter((slice) => slice.value > 0)
    .map((slice) => {
      const rawLength = (slice.value / answered) * circumference;
      const length = Math.max(rawLength - gapPx, 0);
      const offset = -cumulativeLength;
      cumulativeLength += rawLength;
      return { ...slice, length, offset };
    });

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {answered === 0 ? (
          <circle
            cx={radius}
            cy={radius}
            r={innerRadius}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={baseStrokeWidth}
          />
        ) : (
          <g transform={`rotate(-90 ${radius} ${radius})`}>
            {segments.map((segment, index) => (
              <circle
                key={segment.label}
                cx={radius}
                cy={radius}
                r={innerRadius}
                fill="none"
                stroke={segment.color}
                strokeWidth={hoveredIndex === index ? baseStrokeWidth + 4 : baseStrokeWidth}
                strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                strokeDashoffset={segment.offset}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{ transition: 'stroke-width 120ms ease', cursor: 'default' }}
              >
                <title>{`${segment.label}: ${segment.value} (${Math.round((segment.value / answered) * 100)}%)`}</title>
              </circle>
            ))}
          </g>
        )}
        <text
          x={radius}
          y={radius - 4}
          textAnchor="middle"
          style={{ fontSize: 20, fontWeight: 600, fill: '#F4F1F8' }}
        >
          {centerLabel}
        </text>
        <text
          x={radius}
          y={radius + 16}
          textAnchor="middle"
          style={{ fontSize: 11, fill: '#8B86A2' }}
        >
          Score
        </text>
      </svg>
    </div>
  );
};

export default RatingDistributionChart;
