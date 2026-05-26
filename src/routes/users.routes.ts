import { Router } from "express";

import * as usersController from "../controllers/users.controller.js";

export const usersRouter = Router();

/**
 * Sprint 14 addendum: same-org user search. No role gate — staff can also
 * call this (Meetings invite picker will need it). `jwtAuth` is applied at
 * the v1 router level.
 */
usersRouter.get("/search", usersController.searchUsers);
