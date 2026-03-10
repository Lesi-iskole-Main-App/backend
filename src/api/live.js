import express from "express";
import { authenticate } from "./middlewares/authentication.js";
import { authorize } from "./middlewares/authrization.js";

import {
  createLiveByClassId,
  getAllLiveByClassId,
  getLiveByClassIdAndLiveId,
  updateLiveByClassId,
  deleteLiveByClassId,
  getAllLives,
  getStudentLives,
} from "../application/live.js";

const router = express.Router();

// student live list
router.get(
  "/student",
  authenticate,
  authorize(["student"]),
  getStudentLives
);

// all lives
router.get("/", authenticate, getAllLives);

// get all by classId
router.get("/class/:classId", authenticate, getAllLiveByClassId);

// get one by classId + liveId
router.get("/class/:classId/:liveId", authenticate, getLiveByClassIdAndLiveId);

// create
router.post(
  "/class/:classId",
  authenticate,
  authorize(["admin", "teacher"]),
  createLiveByClassId
);

// update
router.patch(
  "/class/:classId/:liveId",
  authenticate,
  authorize(["admin", "teacher"]),
  updateLiveByClassId
);

// delete
router.delete(
  "/class/:classId/:liveId",
  authenticate,
  authorize(["admin", "teacher"]),
  deleteLiveByClassId
);

export default router;