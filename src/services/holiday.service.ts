import type { AuthenticatedUser } from "../middleware/auth.js";
import * as holidayRepo from "../repositories/holiday.repository.js";
import type { ListHolidaysQuery, ToggleHolidayInput } from "../schemas/holiday.schema.js";
import { parseDateString } from "../utils/date.js";

export interface ToggleResult {
  added: boolean;
  holiday: holidayRepo.Holiday | null;
}

export function listHolidays(
  user: AuthenticatedUser,
  query: ListHolidaysQuery,
): Promise<holidayRepo.Holiday[]> {
  return holidayRepo.listInRange(user.id, parseDateString(query.from), parseDateString(query.to));
}

export async function toggleHoliday(
  user: AuthenticatedUser,
  input: ToggleHolidayInput,
): Promise<ToggleResult> {
  const date = parseDateString(input.date);
  const existing = await holidayRepo.findByUserAndDate(user.id, date);

  if (existing) {
    await holidayRepo.remove(user.id, date);
    return { added: false, holiday: null };
  }

  const holiday = await holidayRepo.upsert({
    userId: user.id,
    date,
    ...(input.reason !== undefined && { reason: input.reason }),
  });
  return { added: true, holiday };
}
