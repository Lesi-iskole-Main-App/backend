import express from "express";
import { authenticate } from "../api/middlewares/authentication.js";
import { authorize } from "../api/middlewares/authrization.js";

import {
  getAllTeachers,
  getTeacherById,
  updateTeacherById,
  deleteTeacherById,
  approveTeacher,
  getTeacherAssignFormData,
  createAssignTeacher,
  replaceTeacherAssignments,
  disableTeacherAccess,
} from "../application/teacherAssignment.js";

const router = express.Router();

router.get("/", authenticate, authorize(["admin"]), getAllTeachers);
router.get("/:teacherId", authenticate, authorize(["admin"]), getTeacherById);
router.patch("/:teacherId", authenticate, authorize(["admin"]), updateTeacherById);

// keep delete controller if needed later, but route still removed
// router.delete("/:teacherId", authenticate, authorize(["admin"]), deleteTeacherById);

router.patch(
  "/:teacherId/approve",
  authenticate,
  authorize(["admin"]),
  approveTeacher
);

router.get(
  "/:teacherId/form-data",
  authenticate,
  authorize(["admin"]),
  getTeacherAssignFormData
);

// append classes
router.post(
  "/:teacherId/assign",
  authenticate,
  authorize(["admin"]),
  createAssignTeacher
);

// replace all classes
router.put(
  "/:teacherId/assign",
  authenticate,
  authorize(["admin"]),
  replaceTeacherAssignments
);

// enable / disable access
router.patch(
  "/:teacherId/access",
  authenticate,
  authorize(["admin"]),
  disableTeacherAccess
);

export default router;