import express from "express";
import {
  createReview,
  getAllReviews,
  getReviewById,
  updateReviewById,
  deleteReviewById,
} from "../application/review.js";

const router = express.Router();

router.post("/", createReview);
router.get("/", getAllReviews);
router.get("/:reviewId", getReviewById);
router.patch("/:reviewId", updateReviewById);
router.delete("/:reviewId", deleteReviewById);

export default router;