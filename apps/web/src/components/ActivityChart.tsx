import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import type { Overview } from '../lib/types';
export default function ActivityChart({ data }: { data: Overview['chart'] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: -24, right: 10, top: 16 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--muted)', fontSize: 11 }}
          dy={10}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--muted)', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'var(--panel-hover)', opacity: 0.5 }}
          contentStyle={{
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        />
        <Bar
          dataKey="success"
          name="Successful"
          fill="#39c98f"
          radius={[3, 3, 0, 0]}
          maxBarSize={28}
        />
        <Bar dataKey="failed" name="Failed" fill="#dd7777" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
