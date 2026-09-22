export type HireVisit = {
  occurrence_id?: string;
  schedule_name?: string;
  full_name?: string;
  starts_at?: string;
  ends_at?: string;
  areas?: string[] | string;
};

export function melbourneDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function weekDates(from = new Date()) {
  const today = melbourneDate(from);
  const noon = new Date(`${today}T12:00:00+10:00`);
  const weekday = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short" }).format(noon);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  const start = new Date(noon);
  start.setDate(start.getDate() - Math.max(index, 0));
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    const date = melbourneDate(day);
    return {
      date,
      label: new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short" }).format(day),
      dayNumber: date.slice(8),
    };
  });
}

export function visitDay(visit: HireVisit) {
  if (!visit.starts_at) return "";
  return melbourneDate(new Date(visit.starts_at));
}

export function visitAreas(visit: HireVisit) {
  if (Array.isArray(visit.areas)) return visit.areas;
  if (typeof visit.areas === "string" && visit.areas.trim()) return visit.areas.split(",").map((part) => part.trim());
  return ["Unlisted"];
}

export function weekCounts(visits: HireVisit[], days: { date: string }[]) {
  return days.map((day) => visits.filter((visit) => visitDay(visit) === day.date).length);
}
