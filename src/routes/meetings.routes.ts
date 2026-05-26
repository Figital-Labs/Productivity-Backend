import { Router } from "express";

import * as meetingController from "../controllers/meeting.controller.js";
import { meetingsUpload } from "../middleware/upload.js";

export const meetingsRouter = Router();

/**
 * Sprint 15: meetings family. No role gate — any authenticated user can
 * create + process their own meetings. `jwtAuth` is applied at the v1
 * router level.
 */
meetingsRouter.get("/", meetingController.listMeetings);
meetingsRouter.post("/", meetingController.createMeeting);
meetingsRouter.get("/:id", meetingController.getMeeting);
meetingsRouter.patch("/:id", meetingController.updateMeeting);
meetingsRouter.delete("/:id", meetingController.deleteMeeting);
meetingsRouter.post("/:id/process", meetingsUpload, meetingController.processMeeting);
