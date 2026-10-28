import type { MouseEvent } from "react";
import { lineSvg, chartGeometry, type LineSpec } from "../chartSvg";
import type { Series } from "../analytics";
export function ChartLegend({
  series,
}: {
  series: Pick<Series, "name" | "color" | "dashed">[];
}) {
  return (
    <ul className="chart-legend">
      {series.map((s) => (
        <li key={s.name}>
          <span
            style={{
              borderTop: `3px ${s.dashed ? "dashed" : "solid"} ${s.color}`,
            }}
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}
export function Timeline({
  spec,
  onTime,
}: {
  spec: LineSpec;
  onTime?: (t: number) => void;
}) {
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!onTime) return;
    const svg = e.currentTarget.querySelector("svg")!;
    const rect = svg.getBoundingClientRect();
    onTime(
      Math.max(
        0,
        (Math.min(
          chartGeometry.width - chartGeometry.left - chartGeometry.right,
          ((e.clientX - rect.left) / rect.width) * chartGeometry.width -
            chartGeometry.left,
        ) /
          (chartGeometry.width - chartGeometry.left - chartGeometry.right)) *
          spec.end,
      ),
    );
  };
  return (
    <figure className="analytics-chart">
      <figcaption>{spec.title}</figcaption>
      <ChartLegend series={spec.series} />
      <div
        className="chart-scroll"
        onClick={click}
        dangerouslySetInnerHTML={{ __html: lineSvg(spec) }}
      />
    </figure>
  );
}
