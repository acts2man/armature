/** How a signed-in person is named on screen. */

type UserLike = { email?: string; user_metadata?: Record<string, unknown> } | null | undefined;

/** Their profile name if they gave one, else the part of the email before the @. */
export function displayName(user: UserLike): string {
  const name = user?.user_metadata?.["full_name"];
  if (typeof name === "string" && name.trim()) return name.trim();
  const email = user?.email ?? "";
  return email.split("@")[0] || "there";
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "Good morning" / "Good afternoon" / "Good evening" for the local hour. */
export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
