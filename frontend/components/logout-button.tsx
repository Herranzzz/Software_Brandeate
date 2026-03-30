"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";


type LogoutButtonProps = {
  className?: string;
  label?: string;
};


export function LogoutButton({ className = "button-secondary", label = "Cerrar sesión" }: LogoutButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    setIsPending(true);
    await fetch("/api/auth/logout", {
      method: "POST",
    });
    router.push("/login");
    router.refresh();
  }

  return (
    <button className={className} disabled={isPending} onClick={handleLogout} type="button">
      {isPending ? "Saliendo..." : label}
    </button>
  );
}
