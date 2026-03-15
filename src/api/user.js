import express from "express";
import {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUserById,
  approveTeacher,
  rejectTeacher,
  saveStudentGradeSelection,
  getMyProfile,
} from "../application/user.js";
import { updateMyProfile } from "../application/userProfile.js";

import { authenticate } from "../api/middlewares/authentication.js";
import { authorize } from "../api/middlewares/authrization.js";

const router = express.Router();

/* =========================
   AUTHENTICATED USER
========================= */
router.get("/me", authenticate, getMyProfile);
router.patch("/me/profile", authenticate, updateMyProfile);

/* =========================
   STUDENT: SAVE GRADE ONCE
========================= */
router.patch(
  "/student/grade-selection",
  authenticate,
  authorize(["student"]),
  saveStudentGradeSelection
);

/* =========================
   ADMIN ROUTES
========================= */
router.post("/create", authenticate, authorize(["admin"]), createUser);
router.get("/", authenticate, authorize(["admin"]), getAllUsers);
router.get("/:id", authenticate, authorize(["admin"]), getUserById);
router.put("/:id", authenticate, authorize(["admin"]), updateUser);
router.delete("/:id", authenticate, authorize(["admin"]), deleteUserById);

router.patch(
  "/:id/approve-teacher",
  authenticate,
  authorize(["admin"]),
  approveTeacher
);

router.patch(
  "/:id/reject-teacher",
  authenticate,
  authorize(["admin"]),
  rejectTeacher
);

export default router;