const REPORT_TIME_ZONE = "Asia/Manila";
const REPORT_UTC_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const EARLIEST_REPORT_DATE = "2022-01-01";
// First Sunday on or after 2022-01-01; weeks starting in 2021 stay unavailable.
const EARLIEST_REPORT_WEEK = "2022-01-02";

// Formats a date as a YYYY-MM-DD string in the report time zone.
function dateValueInReportTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// Parses YYYY-MM-DD into a UTC-midnight date, rejecting invalid dates.
function parseCalendarDate(dateValue) {
  if (typeof dateValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return null;
  }
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

// Converts a Manila calendar midnight into its UTC instant.
function manilaMidnightToUtc(calendarDate) {
  return new Date(calendarDate.getTime() - REPORT_UTC_OFFSET_MILLISECONDS);
}

// Resolves a period preset and anchor date into a UTC start/end range.
function getReportPeriod(period, dateValue, now = new Date()) {
  if (!["daily", "weekly", "monthly", "yearly"].includes(period)) {
    return null;
  }
  const anchor = parseCalendarDate(dateValue);
  if (!anchor || dateValue > dateValueInReportTimeZone(now)) {
    return null;
  }
  if (dateValue < EARLIEST_REPORT_DATE) {
    return null;
  }
  if (period === "weekly" && dateValue < EARLIEST_REPORT_WEEK) {
    return null;
  }

  const start = new Date(anchor);
  const end = new Date(anchor);
  if (period === "daily") {
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (period === "weekly") {
    const daysSinceSunday = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - daysSinceSunday);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === "monthly") {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 1);
  } else {
    start.setUTCMonth(0, 1);
    end.setUTCFullYear(end.getUTCFullYear() + 1, 0, 1);
  }

  return {
    start: manilaMidnightToUtc(start),
    end: manilaMidnightToUtc(end),
  };
}

module.exports = {
  REPORT_TIME_ZONE,
  dateValueInReportTimeZone,
  getReportPeriod,
};