"use client";

import type { CSSProperties } from "react";

interface SkeletonProps {
  w?: string;
  h?: string;
  className?: string;
}

export function Skeleton({ w, h, className }: SkeletonProps) {
  const style: CSSProperties = {};
  if (w) style.width = w;
  if (h) style.height = h;
  return <div className={`skeleton${className ? ` ${className}` : ""}`} style={style} />;
}

export function SkeletonTable() {
  return (
    <table className="po-table">
      <tbody>
        {Array.from({ length: 6 }).map((_, row) => (
          <tr key={row} className="po-row">
            {Array.from({ length: 4 }).map((_, col) => (
              <td key={col}>
                <Skeleton h="16px" w={col === 0 ? "120px" : col === 3 ? "60px" : "90px"} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
