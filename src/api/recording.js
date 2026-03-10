import express from "express";
import { authenticate } from "./middlewares/authentication.js";
import { authorize } from "./middlewares/authrization.js";

import {
  createRecordingByClassId,
  getAllRecordingByClassId,
  getRecordingByClassIdAndRecordingId,
  updateRecordingByClassId,
  deleteRecordingByClassId,
  getAllRecordings,
} from "../application/recording.js";

const router = express.Router();

// all recordings (admin/teacher table)
router.get("/", authenticate, getAllRecordings);

// get all by classId
router.get("/class/:classId", authenticate, getAllRecordingByClassId);

// get one by classId + recordingId
router.get(
  "/class/:classId/:recordingId",
  authenticate,
  getRecordingByClassIdAndRecordingId
);

// create
router.post(
  "/class/:classId",
  authenticate,
  authorize(["admin", "teacher"]),
  createRecordingByClassId
);

// update
router.patch(
  "/class/:classId/:recordingId",
  authenticate,
  authorize(["admin", "teacher"]),
  updateRecordingByClassId
);

// delete
router.delete(
  "/class/:classId/:recordingId",
  authenticate,
  authorize(["admin", "teacher"]),
  deleteRecordingByClassId
);

export default router;