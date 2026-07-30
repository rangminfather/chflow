type ZonedParts = {
  date: string;
  seconds: number;
};

function zonedParts(value: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "00";
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  const second = Number(read("second"));
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    seconds: hour * 3600 + minute * 60 + second,
  };
}

function timeSeconds(value: string): number {
  const [hour = "0", minute = "0", second = "0"] = value.split(":");
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
}

export function localDateInTimeZone(value: Date, timeZone: string): string {
  return zonedParts(value, timeZone).date;
}

export function isWithinAttendanceWindow(
  value: Date,
  start: string,
  end: string,
  timeZone: string,
): boolean {
  const current = zonedParts(value, timeZone).seconds;
  const startSeconds = timeSeconds(start);
  const endSeconds = timeSeconds(end);

  if (startSeconds === endSeconds) return true;
  if (startSeconds < endSeconds) {
    return current >= startSeconds && current <= endSeconds;
  }
  return current >= startSeconds || current <= endSeconds;
}
