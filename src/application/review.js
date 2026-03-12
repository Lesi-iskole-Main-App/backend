import ReviewModel from "../infastructure/schemas/review.js";

export const createReview = async (req, res, next) => {
  try {
    const { title, youtubeUrl, description, isActive } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: "title is required",
      });
    }

    if (!youtubeUrl || !String(youtubeUrl).trim()) {
      return res.status(400).json({
        success: false,
        message: "youtubeUrl is required",
      });
    }

    if (!description || !String(description).trim()) {
      return res.status(400).json({
        success: false,
        message: "description is required",
      });
    }

    const lastReview = await ReviewModel.findOne({})
      .sort({ sortOrder: -1, createdAt: -1 })
      .select("sortOrder")
      .lean();

    const nextSortOrder =
      Number.isFinite(Number(lastReview?.sortOrder))
        ? Number(lastReview.sortOrder) + 1
        : 1;

    const review = await ReviewModel.create({
      title: String(title).trim(),
      youtubeUrl: String(youtubeUrl).trim(),
      description: String(description).trim(),
      sortOrder: nextSortOrder,
      isActive: typeof isActive === "boolean" ? isActive : true,
    });

    return res.status(201).json({
      success: true,
      message: "Review created successfully",
      data: review,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllReviews = async (req, res, next) => {
  try {
    const reviews = await ReviewModel.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    next(error);
  }
};

export const getReviewById = async (req, res, next) => {
  try {
    const { reviewId } = req.params;

    const review = await ReviewModel.findById(reviewId).lean();

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: review,
    });
  } catch (error) {
    next(error);
  }
};

export const updateReviewById = async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    const { title, youtubeUrl, description, isActive } = req.body;

    const existing = await ReviewModel.findById(reviewId);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    if (title !== undefined) {
      existing.title = String(title).trim();
    }

    if (youtubeUrl !== undefined) {
      existing.youtubeUrl = String(youtubeUrl).trim();
    }

    if (description !== undefined) {
      existing.description = String(description).trim();
    }

    if (typeof isActive === "boolean") {
      existing.isActive = isActive;
    }

    await existing.save();

    return res.status(200).json({
      success: true,
      message: "Review updated successfully",
      data: existing,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteReviewById = async (req, res, next) => {
  try {
    const { reviewId } = req.params;

    const deleted = await ReviewModel.findByIdAndDelete(reviewId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Review deleted successfully",
      data: deleted,
    });
  } catch (error) {
    next(error);
  }
};