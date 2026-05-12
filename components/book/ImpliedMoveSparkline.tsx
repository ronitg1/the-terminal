"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

export function ImpliedMoveSparkline({ values }: { values: number[] }) {
  if (!values || values.length === 0) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-5 w-14">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke="currentColor" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
