"use client";

import { useState } from "react";


type CopyButtonProps = {
  value: string;
};


export function CopyButton({ value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button className="button-secondary" onClick={handleCopy} type="button">
      {copied ? "Copiado" : "Copiar link"}
    </button>
  );
}
