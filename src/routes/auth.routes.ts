import { Router } from "express";

import * as authController from "../controllers/auth.controller.js";
import { jwtAuth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/signup", authController.signup);
authRouter.post("/login", authController.login);
authRouter.get("/me", jwtAuth, authController.me);
