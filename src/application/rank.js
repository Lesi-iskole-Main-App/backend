import mongoose from "mongoose";
import PaperAttempt from "../infastructure/schemas/paperAttempt.js";
import User from "../infastructure/schemas/user.js";

const toInt = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const normalize = (v) => String(v || "").trim().toLowerCase();

export const getIslandRank = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const limit = Math.min(Math.max(toInt(req.query?.limit, 50), 1), 200);
    const uid = new mongoose.Types.ObjectId(String(userId));

    const currentUser = await User.findById(userId)
      .select("selectedLevel selectedGradeNumber selectedStream role isActive")
      .lean();

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const selectedGradeNumber = Number(currentUser?.selectedGradeNumber || 0) || null;
    const selectedLevel = String(currentUser?.selectedLevel || "").trim().toLowerCase();
    const selectedStream = String(currentUser?.selectedStream || "").trim();
    const normalizedStream = normalize(selectedStream);

    if (!selectedGradeNumber) {
      return res.status(200).json({
        top: [],
        me: {
          studentId: String(userId),
          name: currentUser?.name || "",
          totalCoins: 0,
          totalFinishedExams: 0,
          rank: 0,
        },
      });
    }

    const isAL = selectedGradeNumber === 12 || selectedGradeNumber === 13 || selectedLevel === "al";

    const userScopeMatch = {
      "user.role": "student",
      "user.isActive": true,
      "user.selectedGradeNumber": selectedGradeNumber,
    };

    if (isAL) {
      userScopeMatch["user.selectedStreamNormalized"] = normalizedStream;
    }

    const pipeline = [
      // ✅ only completed attempts + only free/paid
      {
        $match: {
          status: "submitted",
          submittedAt: { $ne: null },
          paymentType: { $in: ["free", "paid"] },
        },
      },

      // ✅ best attempt per (studentId+paperId) by points
      {
        $sort: {
          studentId: 1,
          paperId: 1,
          totalPointsEarned: -1,
          percentage: -1,
          submittedAt: -1,
        },
      },
      {
        $group: {
          _id: { studentId: "$studentId", paperId: "$paperId" },
          bestAttempt: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$bestAttempt" } },

      // ✅ sum per student => totalCoins(points) + totalFinishedExams
      {
        $group: {
          _id: "$studentId",
          totalCoins: { $sum: { $ifNull: ["$totalPointsEarned", 0] } },
          totalFinishedExams: { $sum: 1 },
          lastSubmittedAt: { $max: "$submittedAt" },
        },
      },

      // ✅ attach user first, then scope to grade / stream
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },

      {
        $addFields: {
          "user.selectedStreamNormalized": {
            $toLower: {
              $trim: {
                input: { $ifNull: ["$user.selectedStream", ""] },
              },
            },
          },
        },
      },

      // ✅ grade-wise, and A/L stream-wise
      {
        $match: userScopeMatch,
      },

      // ✅ single numeric score to allow denseRank sortBy with one field
      {
        $addFields: {
          lastTime: { $toLong: { $ifNull: ["$lastSubmittedAt", new Date(0)] } },
        },
      },
      {
        $addFields: {
          score: {
            $add: [
              { $multiply: ["$totalCoins", 1000000000000000] },
              { $multiply: ["$totalFinishedExams", 1000000000000] },
              "$lastTime",
            ],
          },
        },
      },

      { $sort: { score: -1 } },

      {
        $setWindowFields: {
          sortBy: { score: -1 },
          output: {
            rank: { $denseRank: {} },
          },
        },
      },

      {
        $project: {
          studentId: { $toString: "$_id" },
          name: { $ifNull: ["$user.name", "Student"] },
          totalCoins: 1,
          totalFinishedExams: 1,
          rank: 1,
        },
      },

      {
        $facet: {
          top: [{ $limit: limit }],
          me: [{ $match: { studentId: String(userId) } }, { $limit: 1 }],
        },
      },
    ];

    const out = await PaperAttempt.aggregate(pipeline);

    const top = out?.[0]?.top || [];
    const me = (out?.[0]?.me || [])[0] || {
      studentId: String(userId),
      name: currentUser?.name || "",
      totalCoins: 0,
      totalFinishedExams: 0,
      rank: 0,
    };

    return res.status(200).json({ top, me });
  } catch (err) {
    console.error("getIslandRank error:", err);

    if (String(err?.message || "").includes("$setWindowFields")) {
      return res.status(500).json({
        message:
          "MongoDB does not support ranking ($setWindowFields). Upgrade MongoDB to 5.0+ (Atlas is OK).",
      });
    }

    return res.status(500).json({ message: "Internal server error" });
  }
};