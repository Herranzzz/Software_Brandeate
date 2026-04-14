"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "brandeate:last-opened-preview";
const EVENT_NAME = "brandeate:last-opened-preview-changed";

function readStorage(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastOpenedPreview(trackId: string | null) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (trackId) {
      window.sessionStorage.setItem(STORAGE_KEY, trackId);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getLastOpenedPreview(): string | null {
  return readStorage();
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = () => callback();
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot(): string | null {
  return readStorage();
}

function getServerSnapshot(): string | null {
  return null;
}

export function useLastOpenedPreview(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function buildPreviewTrackId(orderId: number, itemId: number): string {
  return `order-${orderId}-item-${itemId}`;
}

export function parseLastOpenedOrderId(trackId: string | null): number | null {
  if (!trackId) {
    return null;
  }
  const match = /^order-(\d+)-/.exec(trackId);
  return match ? Number(match[1]) : null;
}
