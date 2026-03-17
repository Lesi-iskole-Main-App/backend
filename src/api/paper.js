import express from "express";
import { authenticate } from "./middlewares/authentication.js";
import { authorize } from "./middlewares/authrization.js";
import {
  getPaperFormData,
  createPaper,
  getAllPapers,
  updatePaperById,
  deletePaperById,
  publishPaperById,
  getPublishedPapersPublic,
  getPublicPaperSubjects,
} from "../application/paper.js";

const router = express.Router();

// PUBLIC
router.get("/public", getPublishedPapersPublic);
router.get("/public/subjects", getPublicPaperSubjects);

// ADMIN
router.get("/form-data", authenticate, authorize(["admin"]), getPaperFormData);
router.post("/", authenticate, authorize(["admin"]), createPaper);
router.get("/", authenticate, authorize(["admin"]), getAllPapers);
router.patch("/:paperId", authenticate, authorize(["admin"]), updatePaperById);
router.delete("/:paperId", authenticate, authorize(["admin"]), deletePaperById);
router.post("/:paperId/publish", authenticate, authorize(["admin"]), publishPaperById);

export default router;