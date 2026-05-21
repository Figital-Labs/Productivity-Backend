import type { Request, Response } from "express";

import { listHolidaysQuerySchema, toggleHolidayInputSchema } from "../schemas/holiday.schema.js";
import * as holidayService from "../services/holiday.service.js";

export async function list(req: Request, res: Response): Promise<void> {
  const query = listHolidaysQuerySchema.parse(req.query);
  const holidays = await holidayService.listHolidays(req.user, query);
  res.json(holidays);
}

export async function toggle(req: Request, res: Response): Promise<void> {
  const input = toggleHolidayInputSchema.parse(req.body);
  const result = await holidayService.toggleHoliday(req.user, input);
  res.status(result.added ? 201 : 200).json(result);
}
