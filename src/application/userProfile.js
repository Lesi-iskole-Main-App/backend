import User, { DISTRICT_ENUMS } from "../infastructure/schemas/user.js";
import Grade from "../infastructure/schemas/grade.js";

const normalizeText = (value = "") => String(value || "").trim();
const normalizeKey = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, "_");

const sanitizeUser = (userDoc) => {
  if (!userDoc) return null;

  const user = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
  delete user.password;
  return user;
};

export const updateMyProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const {
      name,
      district,
      town,
      selectedLevel,
      selectedGradeNumber,
      selectedStream,
    } = req.body || {};

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (typeof name !== "undefined") {
      const cleanName = normalizeText(name);
      if (!cleanName) {
        return res.status(400).json({ message: "Name is required" });
      }
      user.name = cleanName;
    }

    if (typeof district !== "undefined") {
      const cleanDistrict = normalizeText(district);
      if (cleanDistrict && !DISTRICT_ENUMS.includes(cleanDistrict)) {
        return res.status(400).json({ message: "Invalid district" });
      }
      user.district = cleanDistrict;
    }

    if (typeof town !== "undefined") {
      user.town = normalizeText(town);
    }

    const cleanLevel = normalizeText(selectedLevel).toLowerCase();

    if (
      typeof selectedLevel !== "undefined" ||
      typeof selectedGradeNumber !== "undefined" ||
      typeof selectedStream !== "undefined"
    ) {
      if (cleanLevel === "al") {
        const gradeDoc = await Grade.findOne({
          flowType: "al",
          grade: 12,
          isActive: true,
        }).lean();

        if (!gradeDoc) {
          return res.status(400).json({ message: "A/L flow not found" });
        }

        const cleanStream = normalizeKey(selectedStream);

        if (!cleanStream) {
          return res.status(400).json({ message: "Stream is required for A/L" });
        }

        const streamExists = Array.isArray(gradeDoc.streams)
          ? gradeDoc.streams.some(
              (st) => normalizeKey(st?.stream) === cleanStream
            )
          : false;

        if (!streamExists) {
          return res
            .status(400)
            .json({ message: "Invalid stream for selected grade" });
        }

        user.selectedLevel = "al";
        user.selectedGradeNumber = 12;
        user.selectedStream = cleanStream;
      } else if (
        typeof selectedGradeNumber !== "undefined" &&
        selectedGradeNumber !== null &&
        String(selectedGradeNumber).trim() !== ""
      ) {
        const gradeNumber = Number(selectedGradeNumber);

        if (
          !Number.isInteger(gradeNumber) ||
          gradeNumber < 1 ||
          gradeNumber > 11
        ) {
          return res.status(400).json({ message: "Invalid grade number" });
        }

        const gradeDoc = await Grade.findOne({
          flowType: "normal",
          grade: gradeNumber,
          isActive: true,
        }).lean();

        if (!gradeDoc) {
          return res.status(400).json({ message: "Selected grade not found" });
        }

        user.selectedGradeNumber = gradeNumber;
        user.selectedLevel = gradeNumber <= 5 ? "primary" : "secondary";
        user.selectedStream = null;
      } else if (
        typeof selectedGradeNumber !== "undefined" &&
        (selectedGradeNumber === null || String(selectedGradeNumber).trim() === "")
      ) {
        user.selectedLevel = null;
        user.selectedGradeNumber = null;
        user.selectedStream = null;
      }
    }

    await user.save();

    return res.status(200).json({
      message: "Profile updated successfully",
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
};