function getUtcDateParts(date = new Date()) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate()
  };
}

function toUtcDateOnly(date = new Date()) {
  const { year, month, day } = getUtcDateParts(date);
  return new Date(Date.UTC(year, month, day));
}

function toIsoDateKey(date = new Date()) {
  return toUtcDateOnly(date).toISOString().slice(0, 10);
}

function getYesterdayKey(date = new Date()) {
  const utcDate = toUtcDateOnly(date);
  utcDate.setUTCDate(utcDate.getUTCDate() - 1);
  return toIsoDateKey(utcDate);
}

function getIsoWeekKey(date = new Date()) {
  const utcDate = toUtcDateOnly(date);

  const dayNumber = (utcDate.getUTCDay() + 6) % 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - dayNumber + 3);

  const firstThursday = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const weekNumber = 1 + Math.round((utcDate - firstThursday) / 604800000);
  const year = utcDate.getUTCFullYear();

  return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

function parseIsoWeekKey(weekKey) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);

  if (!match) {
    throw new Error(`Invalid ISO week key: ${weekKey}`);
  }

  return {
    year: Number.parseInt(match[1], 10),
    week: Number.parseInt(match[2], 10)
  };
}

function getIsoWeekStartDate(weekKey) {
  const { year, week } = parseIsoWeekKey(weekKey);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDayNumber = (januaryFourth.getUTCDay() + 6) % 7;

  const weekOneMonday = new Date(januaryFourth);
  weekOneMonday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDayNumber);

  const weekStart = new Date(weekOneMonday);
  weekStart.setUTCDate(weekOneMonday.getUTCDate() + (week - 1) * 7);

  return weekStart;
}

function getNextIsoWeekKey(weekKey) {
  const nextWeek = getIsoWeekStartDate(weekKey);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  return getIsoWeekKey(nextWeek);
}

module.exports = {
  toIsoDateKey,
  getYesterdayKey,
  getIsoWeekKey,
  parseIsoWeekKey,
  getIsoWeekStartDate,
  getNextIsoWeekKey
};
