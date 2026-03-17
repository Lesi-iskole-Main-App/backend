import express from "express";
import {
  getStudentOptions,
  getStudents,
  grantStudentAccess,
  removeStudentAccess,
  bulkRemoveClassAccess,
  banStudent,
  unbanStudent,
} from "../application/studentAdmin.js";
import { authenticate } from "./middlewares/authentication.js";
import { authorize } from "./middlewares/authrization.js";

const router = express.Router();

router.get(
  "/options",
  authenticate,
  authorize(["admin"]),
  getStudentOptions
);

router.get(
  "/",
  authenticate,
  authorize(["admin"]),
  getStudents
);

router.patch(
  "/:id/access-grant",
  authenticate,
  authorize(["admin"]),
  grantStudentAccess
);

router.patch(
  "/:id/access-remove",
  authenticate,
  authorize(["admin"]),
  removeStudentAccess
);

router.patch(
  "/access-remove-all",
  authenticate,
  authorize(["admin"]),
  bulkRemoveClassAccess
);

router.patch(
  "/:id/ban",
  authenticate,
  authorize(["admin"]),
  banStudent
);

router.patch(
  "/:id/unban",
  authenticate,
  authorize(["admin"]),
  unbanStudent
);

export default router;