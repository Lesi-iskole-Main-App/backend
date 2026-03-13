import express from "express";
import { authenticate } from "../api/middlewares/authentication.js";
import { authorize } from "../api/middlewares/authrization.js";

import {
  createGrade,
  updateGradeById,
  deleteGradeById,

  getSubjectsByGrade,
  createSubject,
  updateSubjectById,
  deleteSubjectById,

  getStreamsByGradeId,
  createStream,
  updateStreamById,
  deleteStreamById,

  getStreamSubjects,
  createStreamSubject,
  updateStreamSubjectById,
  deleteStreamSubjectById,

  getGradesPublic,
  getGradeDetailPublic,
  getStreamsSmart,
} from "../application/grade.js";

const router = express.Router();

/* PUBLIC */
router.get("/", getGradesPublic);
router.get("/grades", getGradesPublic);
router.get("/streams/:value", getStreamsSmart);

/* READ */
router.get("/subjects/:gradeId", authenticate, getSubjectsByGrade);
router.get("/streams/admin/:gradeId", authenticate, getStreamsByGradeId);
router.get(
  "/stream/subjects/:gradeId/:streamId",
  authenticate,
  getStreamSubjects
);

/* ADMIN WRITE */
router.post("/grade", authenticate, authorize(["admin"]), createGrade);
router.patch(
  "/grade/:gradeId",
  authenticate,
  authorize(["admin"]),
  updateGradeById
);
router.delete(
  "/grade/:gradeId",
  authenticate,
  authorize(["admin"]),
  deleteGradeById
);

router.post("/subject", authenticate, authorize(["admin"]), createSubject);
router.patch(
  "/subject/:gradeId/:subjectId",
  authenticate,
  authorize(["admin"]),
  updateSubjectById
);
router.delete(
  "/subject/:gradeId/:subjectId",
  authenticate,
  authorize(["admin"]),
  deleteSubjectById
);

router.post("/stream", authenticate, authorize(["admin"]), createStream);
router.patch(
  "/stream/:gradeId/:streamId",
  authenticate,
  authorize(["admin"]),
  updateStreamById
);
router.delete(
  "/stream/:gradeId/:streamId",
  authenticate,
  authorize(["admin"]),
  deleteStreamById
);

router.post("/stream/subject", authenticate, authorize(["admin"]), createStreamSubject);
router.patch(
  "/stream/subject/:gradeId/:streamId/:subjectId",
  authenticate,
  authorize(["admin"]),
  updateStreamSubjectById
);
router.delete(
  "/stream/subject/:gradeId/:streamId/:subjectId",
  authenticate,
  authorize(["admin"]),
  deleteStreamSubjectById
);

/* KEEP LAST */
router.get("/:gradeNumber", getGradeDetailPublic);

export default router;