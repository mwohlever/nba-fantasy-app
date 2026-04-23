export function formatLastUpdated(value: string | null) {
  if (!value) return "Not refreshed yet";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not refreshed yet";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
