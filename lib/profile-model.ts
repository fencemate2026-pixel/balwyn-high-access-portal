export type UserProfile = {
  id: string;
  displayName: string;
  username: string;
  contactEmail: string;
  phone: string;
  jobTitle: string;
  avatarUrl: string | null;
};

export function validateProfileInput(value: Record<string, unknown>) {
  const fields = ["displayName", "username", "contactEmail", "phone", "jobTitle"] as const;
  if (fields.some((field) => typeof value[field] !== "string")) throw new Error("Complete the profile fields.");
  const displayName = (value.displayName as string).trim();
  const username = (value.username as string).trim().toLowerCase();
  const contactEmail = (value.contactEmail as string).trim().toLowerCase();
  const phone = (value.phone as string).trim();
  const jobTitle = (value.jobTitle as string).trim();
  if (!displayName || displayName.length > 100 || /[\x00-\x1f]/.test(displayName)) throw new Error("Enter a name of up to 100 characters.");
  if (username && !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) throw new Error("Use 3–40 letters, numbers, dots, hyphens or underscores for the username.");
  if (contactEmail && (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) throw new Error("Enter a valid contact email.");
  if (phone.length > 40 || (phone && !/^[+()\d\s.-]+$/.test(phone))) throw new Error("Enter a valid phone number.");
  if (jobTitle.length > 100 || /[\x00-\x1f]/.test(jobTitle)) throw new Error("Enter a role or title of up to 100 characters.");
  return { displayName, username, contactEmail, phone, jobTitle };
}

export function avatarContentType(bytes: Uint8Array): string | null {
  if (bytes.length < 12 || bytes.length > 3 * 1024 * 1024) return null;
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
