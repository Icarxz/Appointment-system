import { Box, Flex, HStack, Text, Tooltip, useColorModeValue } from '@chakra-ui/react';
import type { ReactNode } from 'react';

// Small dependency-free chart pieces shared by the Admin/Dean report and the faculty analytics.
// Hand-built SVG/CSS on purpose: no charting library is installed, and a new one this close to
// the defense would be an untested dependency.

export interface LV { label: string; value: number }

const useTheme = () => ({
  surface: useColorModeValue('#ffffff', '#111d30'),
  tint: useColorModeValue('#f1f5f9', '#0c1421'),
  border: useColorModeValue('#dde3ec', '#1e3048'),
  text: useColorModeValue('#0f2240', '#e8f0fe'),
  muted: useColorModeValue('#6b7fa0', '#7a93b0'),
});

export function ChartCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <Box bg={t.surface} p={5} borderRadius="lg" borderWidth="1px" borderColor={t.border} shadow="sm" h="100%">
      <Text fontWeight="700" fontSize="sm" color={t.text}>{title}</Text>
      {hint && <Text fontSize="xs" color={t.muted} mb={3}>{hint}</Text>}
      {!hint && <Box mb={3} />}
      {children}
    </Box>
  );
}

// Big-number tile. With onClick it becomes a button (used to open the "who" side panel).
export function KpiTile({ label, value, sub, accent = '#2563eb', onClick, hint }: {
  label: string; value: string | number; sub?: string; accent?: string; onClick?: () => void; hint?: string;
}) {
  const t = useTheme();
  const body = (
    <Box
      bg={t.surface} p={4} borderRadius="lg" borderWidth="1px" borderColor={t.border} borderTopWidth="3px" borderTopColor={accent}
      textAlign="left" h="100%"
      {...(onClick ? {
        as: 'button', cursor: 'pointer', onClick, w: '100%',
        _hover: { shadow: 'md', borderColor: accent }, _focusVisible: { outline: '2px solid', outlineColor: accent },
      } : {})}
    >
      <Text fontSize="xs" color={t.muted} fontWeight="600">{label}{onClick ? ' ›' : ''}</Text>
      <Text fontSize="3xl" fontWeight="800" color={t.text} lineHeight="1.1">{value}</Text>
      {sub && <Text fontSize="11px" color={t.muted} mt={1} whiteSpace="pre-line" minH="2.8em" lineHeight="1.4">{sub}</Text>}
    </Box>
  );
  return hint ? <Tooltip label={hint} hasArrow openDelay={300}>{body}</Tooltip> : body;
}

// Sorted horizontal bars: best for comparing categories (purposes, faculty load).
export function HBarChart({ items, color = '#2563eb', emptyText = 'No data yet.' }: {
  items: { label: string; value: number; note?: string }[]; color?: string; emptyText?: string;
}) {
  const t = useTheme();
  if (!items.length || items.every(i => i.value === 0)) return <Text fontSize="sm" color={t.muted}>{emptyText}</Text>;
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <Box>
      {items.map(i => (
        <Flex key={i.label} align="center" gap={3} mb={2}>
          <Text fontSize="sm" color={t.text} w={{ base: '110px', md: '170px' }} flexShrink={0} noOfLines={1} title={i.label}>{i.label}</Text>
          <Box flex="1" bg={t.tint} borderRadius="4px" h="14px">
            <Box h="100%" borderRadius="4px" bg={color} w={`${(i.value / max) * 100}%`} minW={i.value > 0 ? '4px' : 0} />
          </Box>
          <Text fontSize="sm" fontWeight="700" color={t.text} w="90px" textAlign="right" flexShrink={0}>
            {i.value}{i.note ? <Text as="span" fontWeight="400" color={t.muted} fontSize="xs"> {i.note}</Text> : null}
          </Text>
        </Flex>
      ))}
    </Box>
  );
}

// One bar split into parts, with a legend (counts and share). Used for outcomes.
export function StackedBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const t = useTheme();
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return <Text fontSize="sm" color={t.muted}>No data yet.</Text>;
  const shown = segments.filter(s => s.value > 0);
  return (
    <Box>
      <Flex h="22px" borderRadius="6px" overflow="hidden" role="img" aria-label="Outcome breakdown">
        {shown.map(s => <Box key={s.label} bg={s.color} w={`${(s.value / total) * 100}%`} title={`${s.label}: ${s.value}`} />)}
      </Flex>
      <Flex wrap="wrap" mt={3} columnGap={5} rowGap={1}>
        {shown.map(s => (
          <HStack key={s.label} spacing={2}>
            <Box w="10px" h="10px" borderRadius="2px" bg={s.color} />
            <Text fontSize="xs" color={t.text}>{s.label} <b>{s.value}</b> <Text as="span" color={t.muted}>({Math.round((s.value / total) * 100)}%)</Text></Text>
          </HStack>
        ))}
      </Flex>
    </Box>
  );
}
// Pie chart with a legend that shows every count and percentage (so no slice has to be read by angle).
export function PieChart({ segments, size = 170 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const t = useTheme();
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return <Text fontSize="sm" color={t.muted}>No data yet.</Text>;
  const shown = segments.filter(s => s.value > 0);
  const r = size / 2 - 2, c = size / 2;
  let angle = -Math.PI / 2;
  const slices = shown.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle, a1 = angle + sweep;
    angle = a1;
    const p = (a: number) => `${c + r * Math.cos(a)} ${c + r * Math.sin(a)}`;
    return { ...s, d: `M ${c} ${c} L ${p(a0)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${p(a1)} Z` };
  });
  return (
    <Flex direction="column" align="center" gap={4}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Outcome breakdown pie chart">
        {shown.length === 1
          ? <circle cx={c} cy={c} r={r} fill={shown[0].color}><title>{`${shown[0].label}: ${shown[0].value}`}</title></circle>
          : slices.map(s => <path key={s.label} d={s.d} fill={s.color} stroke={t.surface} strokeWidth="2"><title>{`${s.label}: ${s.value}`}</title></path>)}
      </svg>
      <Box w="100%">
        {shown.map(s => (
          <HStack key={s.label} spacing={2} py="2px">
            <Box w="10px" h="10px" borderRadius="2px" bg={s.color} flexShrink={0} />
            <Text fontSize="xs" color={t.text} flex="1">{s.label}</Text>
            <Text fontSize="xs" color={t.text}><b>{s.value}</b> <Text as="span" color={t.muted}>({Math.round((s.value / total) * 100)}%)</Text></Text>
          </HStack>
        ))}
      </Box>
    </Flex>
  );
}

// Line chart for values over time (weekly or monthly counts).
export function LineChart({ data, color = '#2563eb', height = 190 }: { data: LV[]; color?: string; height?: number }) {
  const t = useTheme();
  const W = 600, padL = 30, padR = 14, padT = 20, padB = 30;
  const max = Math.max(1, ...data.map(d => d.value));
  const px = (i: number) => padL + (data.length <= 1 ? 0.5 : i / (data.length - 1)) * (W - padL - padR);
  const py = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(d.value)}`).join(' ');
  const area = data.length ? `${line} L${px(data.length - 1)},${py(0)} L${px(0)},${py(0)} Z` : '';
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Trend over time">
      <line x1={padL} x2={W - padR} y1={py(0)} y2={py(0)} stroke={t.border} />
      <line x1={padL} x2={W - padR} y1={py(max)} y2={py(max)} stroke={t.border} strokeDasharray="3 4" />
      <text x={padL - 6} y={py(0) + 4} fontSize="10" textAnchor="end" fill={t.muted}>0</text>
      <text x={padL - 6} y={py(max) + 4} fontSize="10" textAnchor="end" fill={t.muted}>{max}</text>
      {data.length > 0 && <path d={area} fill={color} opacity="0.1" />}
      {data.length > 0 && <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />}
      {data.map((d, i) => (
        <g key={`${d.label}-${i}`}>
          <circle cx={px(i)} cy={py(d.value)} r="3.5" fill={color}><title>{`${d.label}: ${d.value}`}</title></circle>
          {d.value > 0 && <text x={px(i)} y={py(d.value) - 8} fontSize="10" fontWeight="700" textAnchor="middle" fill={t.text}>{d.value}</text>}
          <text x={px(i)} y={height - 8} fontSize="10" textAnchor="middle" fill={t.muted}>{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

export interface HeatmapData { days: string[]; hours: { hour: number; label: string }[]; cells: number[][]; max: number }

// Busiest day × hour: darker = more requests.
export function Heatmap({ data }: { data: HeatmapData }) {
  const t = useTheme();
  if (data.max === 0) return <Text fontSize="sm" color={t.muted}>No requests yet.</Text>;
  return (
    <Box overflowX="auto">
      <Box display="grid" gridTemplateColumns={`56px repeat(${data.days.length}, minmax(44px, 1fr))`} gap="3px" minW="340px">
        <Box />
        {data.days.map(d => <Text key={d} fontSize="xs" fontWeight="700" textAlign="center" color={t.muted}>{d}</Text>)}
        {data.hours.map((h, r) => (
          <Box key={h.hour} display="contents">
            <Text fontSize="xs" color={t.muted} textAlign="right" pr={2} alignSelf="center">{h.label}</Text>
            {data.days.map((d, c) => {
              const v = data.cells[r][c];
              const a = v ? 0.15 + 0.85 * (v / data.max) : 0;
              return (
                <Flex key={d} h="30px" borderRadius="4px" align="center" justify="center" fontSize="xs" fontWeight="700"
                  bg={v ? `rgba(37,99,235,${a})` : t.tint} color={a > 0.55 ? '#fff' : t.text} title={`${d} ${h.label}: ${v} request${v === 1 ? '' : 's'}`}>
                  {v || ''}
                </Flex>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
