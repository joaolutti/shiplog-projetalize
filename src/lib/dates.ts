/**
 * Dates as the team sees them (D42): every label and day bucket is in America/Sao_Paulo,
 * whatever the server's zone (Render runs in UTC). Labels are pt-BR.
 */
export const TZ = "America/Sao_Paulo";

const keyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" });
const weekdayShort = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short" });

// "2026-11-11": the São Paulo calendar day, for grouping.
export const dayKey = (d: Date) => keyFormat.format(d);

// Noon UTC of a day key, so adding days never crosses a zone edge.
export const fromDayKey = (key: string) => new Date(`${key}T12:00:00Z`);

export function addDays(key: string, days: number): string {
  const d = fromDayKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Start of the São Paulo day `daysAgo` days before today, as an instant.
export function startOfDayAgo(daysAgo: number, now = new Date()): Date {
  const key = addDays(dayKey(now), -daysAgo);
  // São Paulo is UTC-3 all year (no DST since 2019).
  return new Date(`${key}T03:00:00Z`);
}

const strip = (s: string) => s.replace(".", "");

// "seg", "ter"…
export const weekday = (key: string) => strip(weekdayShort.format(fromDayKey(key)));

// "11 nov., 14:05" → "11 nov, 14:05"
export const shortDate = (d: Date) => `${strip(dayMonth.format(d))}, ${timeFormat.format(d)}`;

// "hoje às 14:05", "ontem às 09:10", "seg, 09 nov às 18:00"
export function when(d: Date, now = new Date()): string {
  const k = dayKey(d);
  const today = dayKey(now);
  const day = k === today ? "hoje" : k === addDays(today, -1) ? "ontem" : `${weekday(k)}, ${strip(dayMonth.format(d))}`;
  return `${day} às ${timeFormat.format(d)}`;
}

// "agora", "há 5 min", "há 3 h", "há 2 dias"
export function ago(d: Date, now = new Date()): string {
  const min = Math.round((now.getTime() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

export const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const OPEN = 9;
const CLOSE = 18;
const isWeekday = (key: string) => ![0, 6].includes(fromDayKey(key).getUTCDay());

// `d` if it falls in São Paulo business hours (Monday–Friday, 9:00–18:00), else when they next open.
// shortcut: national holidays count as business days; add a holiday list if reminders land on one.
export function nextBusinessTime(d: Date): Date {
  const key = dayKey(d);
  // São Paulo is UTC-3 all year, so its midnight is 03:00 UTC.
  const hour = (d.getTime() - Date.parse(`${key}T03:00:00Z`)) / 3_600_000;
  if (isWeekday(key) && hour >= OPEN && hour < CLOSE) return d;
  let next = isWeekday(key) && hour < OPEN ? key : addDays(key, 1);
  while (!isWeekday(next)) next = addDays(next, 1);
  return new Date(`${next}T${String(OPEN + 3).padStart(2, "0")}:00:00Z`);
}
