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
  updateSelf,
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
router.put("/me", authenticate, updateSelf);

/* =========================
   STUDENT: GRADE SELECTION
   Fully bidirectional - no lock.
   Grade 1 → A/L, A/L → Grade 3, etc.

   Body (normal grade):
     { "gradeNumber": 6 }

   Body (A/L):
     { "gradeNumber": 12, "stream": "physical_science" }
     { "level": "al",    "stream": "commerce" }

   Body (clear):
     { "gradeNumber": null }
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