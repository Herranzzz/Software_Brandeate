import { EmployeesManagementPanel } from "@/components/employees-management-panel";
import { fetchEmployeeAnalytics, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import type { EmployeeMetricsPeriod } from "@/lib/types";


type EmployeesPageProps = {
  searchParams: Promise<{
    period?: string;
  }>;
};


function resolveEmployeePeriod(value?: string): EmployeeMetricsPeriod {
  return value === "day" ? "day" : "week";
}


export default async function EmployeesPage({ searchParams }: EmployeesPageProps) {
  const params = await searchParams;
  const period = resolveEmployeePeriod(params.period);

  const [userResult, shopsResult, analyticsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchShops(),
    fetchEmployeeAnalytics({ period }),
  ]);
  if (userResult.status === "rejected") throw userResult.reason;

  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value.employees : [];

  return (
    <EmployeesManagementPanel
      employees={analytics}
      period={period}
      periodLinks={[
        { label: "Día", href: "/employees?period=day", active: period === "day" },
        { label: "Semana", href: "/employees?period=week", active: period === "week" },
      ]}
      shops={shops}
    />
  );
}
