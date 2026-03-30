import { redirect } from "next/navigation";

import { fetchCurrentUser } from "@/lib/auth";


export default async function HomePage() {
  const user = await fetchCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role === "super_admin" || user.role === "ops_admin") {
    redirect("/dashboard");
  }

  redirect("/portal");
}
