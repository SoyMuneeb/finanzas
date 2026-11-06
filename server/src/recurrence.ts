export function advanceDate(
  date: string,
  frequency: string,
  anchorDay: number,
): string {
  const d = new Date(date + "T00:00:00Z");
  if (frequency === "WEEKLY") d.setUTCDate(d.getUTCDate() + 7);
  else {
    const y = d.getUTCFullYear() + (frequency === "YEARLY" ? 1 : 0),
      m = d.getUTCMonth() + (frequency === "MONTHLY" ? 1 : 0);
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    d.setTime(Date.UTC(y, m, Math.min(anchorDay, last)));
  }
  return d.toISOString().slice(0, 10);
}
