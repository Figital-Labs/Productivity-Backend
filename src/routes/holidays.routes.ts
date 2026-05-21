import { Router } from "express";

import * as holidayController from "../controllers/holiday.controller.js";

export const holidaysRouter = Router();

holidaysRouter.get("/", holidayController.list);
holidaysRouter.post("/toggle", holidayController.toggle);
