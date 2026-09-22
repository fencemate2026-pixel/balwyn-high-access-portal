import type { AccessRule, AIInsight, DashboardSnapshot, ScheduleRule } from "../../shared/types";
import { AccessControl } from "../components/AccessControl";
import { AIInsights } from "../components/AIInsights";
import { Dashboard } from "../components/Dashboard";
import { Scheduler } from "../components/Scheduler";

interface AdminProps {
  dashboard: DashboardSnapshot;
  accessRules: AccessRule[];
  schedules: ScheduleRule[];
  insights: AIInsight[];
}

export function Admin({ dashboard, accessRules, schedules, insights }: AdminProps){
  return (
    <div className="stacked-layout">
      <Dashboard dashboard={dashboard} />
      <div className="dual-grid">
        <AccessControl accessRules={accessRules} />
        <Scheduler schedules={schedules} />
      </div>
      <AIInsights insights={insights} />
    </div>
  );
}
