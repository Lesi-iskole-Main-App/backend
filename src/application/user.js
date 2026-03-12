import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../infastructure/schemas/user.js";

const normalizePhone = (value = "") => String(value || "").trim();
const normalizeText = (value = "") => String(value || "").trim();

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

    return res.status(200).json(user);
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

export const saveStudentGradeSelection = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { level, grade, gradeNumber, stream } = req.body || {};

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
        .json({ message: "Only students can save grade selection" });
    }

    if (user.gradeSelectionLocked) {
      return res
        .status(400)
        .json({ message: "Grade selection already locked" });
    }

    const cleanLevel = normalizeText(level).toLowerCase();
    const cleanGrade = normalizeText(grade);
    const cleanStream = normalizeText(stream || "");

    let finalGradeNumber = Number(gradeNumber);

    if (!Number.isFinite(finalGradeNumber)) {
      const gradeNumberMatch = cleanGrade.match(/(\d{1,2})/);
      finalGradeNumber = gradeNumberMatch
        ? Number(gradeNumberMatch[1])
        : Number(cleanGrade);
    }

    if (!cleanLevel || !Number.isFinite(finalGradeNumber)) {
      return res
        .status(400)
        .json({ message: "level and valid grade are required" });
    }

    user.selectedLevel = cleanLevel;
    user.selectedGradeNumber = finalGradeNumber;
    user.selectedStream = cleanStream || null;
    user.gradeSelectionLocked = true;
    user.gradeSelectedAt = new Date();

    await user.save();

    return res.status(200).json({
      message: "Grade selection saved successfully",
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
};