import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../infastructure/schemas/user.js";
import Grade from "../infastructure/schemas/grade.js";

const normalizePhone = (value = "") => String(value || "").trim();
const normalizeText = (value = "") => String(value || "").trim();
const normalizeKey = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, "_");

const sanitizeUser = (userDoc) => {
  if (!userDoc) return null;
  const user = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
  delete user.password;
  return user;
};

const parseBirthday = (value) => {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const raw = String(value).trim();

  const dotted = raw.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (dotted) {
    const iso = `${dotted[1]}-${dotted[2]}-${dotted[3]}T00:00:00.000Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dashed) {
    const iso = `${dashed[1]}-${dashed[2]}-${dashed[3]}T00:00:00.000Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  return d;
};

const levelFromGradeNumber = (n) => {
  if (n >= 1 && n <= 5) return "primary";
  if (n >= 6 && n <= 11) return "secondary";
  if (n >= 12 && n <= 13) return "al";
  return null;
};

export const getMyProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId)
      .select(
        "_id name phonenumber role district town address birthday selectedLanguage selectedLevel selectedGradeNumber selectedStream gradeSelectionLocked gradeSelectedAt isVerified isApproved progressHighWaterMark progressUpdatedAt createdAt updatedAt"
      )
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
};

export const updateSelf = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const ALLOWED = ["name", "district", "town", "address", "birthday", "selectedLanguage"];
    const updates = {};

    for (const key of ALLOWED) {
      if (typeof req.body?.[key] !== "undefined") {
        updates[key] = req.body[key];
      }
    }

    if (typeof updates.name !== "undefined")     updates.name     = normalizeText(updates.name);
    if (typeof updates.district !== "undefined") updates.district = normalizeText(updates.district);
    if (typeof updates.town !== "undefined")     updates.town     = normalizeText(updates.town);
    if (typeof updates.address !== "undefined")  updates.address  = normalizeText(updates.address);
    if (typeof updates.birthday !== "undefined") updates.birthday = parseBirthday(updates.birthday);

    const updated = await User.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true,
      context: "query",
      select: "-password",
    }).lean();

    if (!updated) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({ message: "Profile updated successfully", user: updated });
  } catch (err) {
    next(err);
  }
};

export const createUser = async (req, res, next) => {
  try {
    const {
      name,
      phonenumber,
      password,
      role = "student",
      district = "",
      town = "",
      address = "",
      birthday = null,
      selectedLanguage = "si",
    } = req.body || {};

    if (!name || !phonenumber || !password) {
      return res.status(400).json({
        message: "name, phonenumber and password are required",
      });
    }

    const existing = await User.findOne({
      phonenumber: normalizePhone(phonenumber),
    }).lean();

    if (existing) {
      return res.status(409).json({
        message: "User already exists with this phone number",
      });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const birthdayDate = parseBirthday(birthday);

    const created = await User.create({
      name: normalizeText(name),
      phonenumber: normalizePhone(phonenumber),
      password: hashedPassword,
      role: normalizeText(role || "student").toLowerCase(),
      district: normalizeText(district),
      town: normalizeText(town),
      address: normalizeText(address),
      birthday: birthdayDate,
      selectedLanguage: selectedLanguage === "en" ? "en" : "si",
    });

    return res.status(201).json({
      message: "User created successfully",
      user: sanitizeUser(created),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Duplicate phone number" });
    }
    next(err);
  }
};

export const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({})
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

export const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(id).select("-password").lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(user);
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const updates = { ...(req.body || {}) };

    if (typeof updates.phonenumber !== "undefined") {
      updates.phonenumber = normalizePhone(updates.phonenumber);
    }
    if (typeof updates.name !== "undefined") {
      updates.name = normalizeText(updates.name);
    }
    if (typeof updates.district !== "undefined") {
      updates.district = normalizeText(updates.district);
    }
    if (typeof updates.town !== "undefined") {
      updates.town = normalizeText(updates.town);
    }
    if (typeof updates.address !== "undefined") {
      updates.address = normalizeText(updates.address);
    }
    if (typeof updates.password !== "undefined" && updates.password) {
      updates.password = await bcrypt.hash(String(updates.password), 10);
    } else {
      delete updates.password;
    }
    if (typeof updates.birthday !== "undefined") {
      updates.birthday = parseBirthday(updates.birthday);
    }

    const updated = await User.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
      context: "query",
      select: "-password",
    }).lean();

    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "User updated successfully",
      user: updated,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Duplicate phone number" });
    }
    next(err);
  }
};

export const deleteUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const deleted = await User.findByIdAndDelete(id).lean();

    if (!deleted) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (err) {
    next(err);
  }
};

export const approveTeacher = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const updated = await User.findByIdAndUpdate(
      id,
      {
        isApproved: true,
        approvedAt: new Date(),
        approvedBy: req.user?.id || null,
      },
      {
        new: true,
        runValidators: true,
        context: "query",
        select: "-password",
      }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Teacher approved successfully",
      user: updated,
    });
  } catch (err) {
    next(err);
  }
};

export const rejectTeacher = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const updated = await User.findByIdAndUpdate(
      id,
      {
        isApproved: false,
        approvedAt: null,
        approvedBy: null,
      },
      {
        new: true,
        runValidators: true,
        context: "query",
        select: "-password",
      }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Teacher rejected successfully",
      user: updated,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT GRADE SELECTION  (fully bidirectional — no lock)
//
// Supports ALL transitions:
//   Grade 1  → Grade 12 A/L Physical Science
//   Grade 12 A/L → Grade 3
//   Grade 12 Commerce → Grade 12 Arts
//   Grade 5  → Grade 9
//   any grade → clear (gradeNumber: null)
// ─────────────────────────────────────────────────────────────────────────────
export const saveStudentGradeSelection = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "student") {
      return res
        .status(403)
        .json({ message: "Only students can update grade selection" });
    }

    const { gradeNumber, level, stream } = req.body || {};

    // ── Clear selection ────────────────────────────────────────────────────
    const rawGradeNumber = gradeNumber ?? null;

    if (
      rawGradeNumber === null ||
      rawGradeNumber === "" ||
      rawGradeNumber === undefined
    ) {
      user.selectedLevel = null;
      user.selectedGradeNumber = null;
      user.selectedStream = null;
      user.gradeSelectedAt = new Date();
      await user.save();

      return res.status(200).json({
        message: "Grade selection cleared",
        user: sanitizeUser(user),
      });
    }

    // ── Resolve intended grade number ──────────────────────────────────────
    const cleanLevel = normalizeText(level).toLowerCase();
    const isALByLevel = cleanLevel === "al";

    let intendedGrade;
    if (String(rawGradeNumber).toLowerCase() === "al") {
      intendedGrade = 12;
    } else {
      intendedGrade = Number(rawGradeNumber);
    }

    if (
      !Number.isInteger(intendedGrade) ||
      intendedGrade < 1 ||
      intendedGrade > 13
    ) {
      return res
        .status(400)
        .json({ message: "gradeNumber must be between 1 and 13 (or 'al')" });
    }

    const isAL = isALByLevel || intendedGrade === 12 || intendedGrade === 13;

    // ── A/L path ───────────────────────────────────────────────────────────
    if (isAL) {
      const cleanStream = normalizeKey(stream);

      if (!cleanStream) {
        return res.status(400).json({
          message:
            "stream is required for A/L. Valid values: physical_science, biological_science, commerce, arts, technology, common",
        });
      }

      const gradeDoc = await Grade.findOne({
        flowType: "al",
        grade: 12,
        isActive: true,
      }).lean();

      if (!gradeDoc) {
        return res
          .status(400)
          .json({ message: "A/L grade is not configured in the system" });
      }

      const streamExists = Array.isArray(gradeDoc.streams)
        ? gradeDoc.streams.some(
            (st) => normalizeKey(st?.stream) === cleanStream
          )
        : false;

      if (!streamExists) {
        const validStreams = (gradeDoc.streams || [])
          .map((st) => st?.stream)
          .filter(Boolean);

        return res.status(400).json({
          message: `Invalid stream "${cleanStream}". Valid streams: ${validStreams.join(", ")}`,
          validStreams,
        });
      }

      user.selectedLevel = "al";
      user.selectedGradeNumber = 12;
      user.selectedStream = cleanStream;
      user.gradeSelectedAt = new Date();
      await user.save();

      return res.status(200).json({
        message: `Grade selection updated to A/L - ${cleanStream}`,
        user: sanitizeUser(user),
      });
    }

    // ── Normal path (grades 1–11) ──────────────────────────────────────────
    if (intendedGrade < 1 || intendedGrade > 11) {
      return res
        .status(400)
        .json({ message: "Normal grades must be between 1 and 11" });
    }

    const gradeDoc = await Grade.findOne({
      flowType: "normal",
      grade: intendedGrade,
      isActive: true,
    }).lean();

    if (!gradeDoc) {
      return res.status(400).json({
        message: `Grade ${intendedGrade} is not found or not active in the system`,
      });
    }

    user.selectedLevel = levelFromGradeNumber(intendedGrade);
    user.selectedGradeNumber = intendedGrade;
    user.selectedStream = null;
    user.gradeSelectedAt = new Date();
    await user.save();

    return res.status(200).json({
      message: `Grade selection updated to Grade ${intendedGrade}`,
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
};