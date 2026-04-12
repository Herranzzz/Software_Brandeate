"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SESSION_KEY = "order_nav_list";

/** Call this from the orders list before navigating to a detail page */
export function saveOrderNavList(orderedIds: number[]) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(orderedIds));
  } catch {}
}

export function OrderNav({ currentId }: { currentId: number }) {
  const [prevId, setPrevId] = useState<number | null>(null);
  const [nextId, setNextId] = useState<number | null>(null);
  const [pos, setPos] = useState<{ idx: number; total: number } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const list: number[] = JSON.parse(raw);
      const idx = list.indexOf(currentId);
      if (idx === -1) return;
      setPrevId(list[idx - 1] ?? null);
      setNextId(list[idx + 1] ?? null);
      setPos({ idx: idx + 1, total: list.length });
    } catch {}
  }, [currentId]);

  if (!pos) return null;

  return (
    <>
      {prevId ? (
        <Link className="button button-secondary" href={`/orders/${prevId}`} title="Pedido anterior">
          ‹ Anterior
        </Link>
      ) : (
        <span className="button button-secondary order-nav-disabled">‹ Anterior</span>
      )}
      <span className="order-nav-pos">{pos.idx} / {pos.total}</span>
      {nextId ? (
        <Link className="button button-secondary" href={`/orders/${nextId}`} title="Pedido siguiente">
          Siguiente ›
        </Link>
      ) : (
        <span className="button button-secondary order-nav-disabled">Siguiente ›</span>
      )}
    </>
  );
}
