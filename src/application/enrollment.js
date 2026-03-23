import mongoose from "mongoose";
import Enrollment from "../infastructure/schemas/enrollment.js";
import User, { SL_PHONE_REGEX } from "../infastructure/schemas/user.js";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSLPhone = (phone) => {
  const p = String(phone || "").trim();

  if (p.startsWith("+94")) return p;
  if (p.startsWith("94")) return `+${p}`;
  if (p.startsWith("0")) return `+94${p.slice(1)}`;

  return p;
};

const AL_STREAM_LABELS = {
  physical_science: "Physical Science",
  biological_science: "Biological Science",
  commerce: "Commerce",
  arts: "Arts",
  technology: "Technology",
  common: "Common",
};

const getString = (...values) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

const idsEqual = (a, b) => String(a || "").trim() === String(b || "").trim();

const getStreamLabel = (streamKey) => {
  const key = normalizeKey(streamKey);
  return AL_STREAM_LABELS[key] || String(streamKey || "").trim();
};

const getLevelFromGradeDoc = (gradeDoc) => {
  if (!gradeDoc) return "";
  if (gradeDoc.flowType === "al") return "al";
  if (gradeDoc.grade >= 1 && gradeDoc.grade <= 5) return "primary";
  if (gradeDoc.grade >= 6 && gradeDoc.grade <= 11) return "secondary";
  return "";
};

const getSubjectNameFromGrade = (gradeDoc, cls) => {
  if (!cls) return "Unknown";

  // ✅ current A/L class logic
  if (String(gradeDoc?.flowType || "") === "al") {
    const alSubject = getString(cls.alSubjectName);
    if (alSubject) return alSubject;
  }

  // ✅ normal class subject from grade subjectId
  if (String(gradeDoc?.flowType || "") === "normal") {
    const subjectObj = (gradeDoc?.subjects || []).find((s) =>
      idsEqual(s._id, cls.subjectId)
    );

    return getString(subjectObj?.subject) || "Unknown";
  }

  // ✅ legacy A/L fallback
  if (String(gradeDoc?.flowType || "") === "al") {
    const streamObj = (gradeDoc?.streams || []).find((s) =>
      idsEqual(s._id, cls.streamId)
    );

    const subjectObj = (streamObj?.subjects || []).find((s) =>
      idsEqual(s._id, cls.streamSubjectId)
    );

    return getString(subjectObj?.subject) || "Unknown";
  }

  return "Unknown";
};

const getStreamNameFromGrade = (gradeDoc, cls) => {
  if (!cls || !gradeDoc || gradeDoc.flowType !== "al") return "";

  const legacyStreamObj = (gradeDoc.streams || []).find((s) =>
    idsEqual(s._id, cls.streamId)
  );

  return getString(legacyStreamObj?.stream);
};

const classReadableDetails = async (classId) => {
  const cls = await ClassModel.findById(classId).lean();
  if (!cls) return null;

  const gradeDoc = cls.gradeId ? await Grade.findById(cls.gradeId).lean() : null;
  if (!gradeDoc) return null;

  const subject = getSubjectNameFromGrade(gradeDoc, cls);
  const stream = getStreamNameFromGrade(gradeDoc, cls);

  return {
    classId: cls._id,
    className: getString(cls.className),
    batchNumber: getString(cls.batchNumber),
    flowType: String(gradeDoc.flowType || "normal"),
    level: getLevelFromGradeDoc(gradeDoc),
    grade: Number(gradeDoc?.grade || 0) || null,
    gradeLabel:
      gradeDoc.flowType === "al"
        ? "A/L"
        : gradeDoc?.grade
        ? `Grade ${gradeDoc.grade}`
        : "",
    stream,
    streamLabel: stream ? getStreamLabel(stream) : "",
    subject,
    imageUrl: getString(cls.imageUrl),
  };
};

export const requestEnroll = async (req, res) => {
  try {
    const { classId, studentName, studentPhone } = req.body || {};

    if (!classId) {
      return res.status(400).json({ message: "classId is required" });
    }

    if (!isValidId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const student = await User.findById(req.user?.id).lean();
    if (!student || student.role !== "student") {
      return res
        .status(403)
        .json({ message: "Only students can request enrollment" });
    }

    const cls = await ClassModel.findById(classId).lean();
    if (!cls) return res.status(404).json({ message: "Class not found" });

    const snapName = String(studentName || student.name || "").trim();
    const rawPhone = String(studentPhone || student.phonenumber || "").trim();
    const snapPhone = normalizeSLPhone(rawPhone);

    if (!snapName) {
      return res.status(400).json({ message: "studentName is required" });
    }

    if (!rawPhone) {
      return res.status(400).json({ message: "studentPhone is required" });
    }

    if (!SL_PHONE_REGEX.test(rawPhone) && !SL_PHONE_REGEX.test(snapPhone)) {
      return res.status(400).json({
        message: "studentPhone must be a valid Sri Lankan phone number",
      });
    }

    const existing = await Enrollment.findOne({
      studentId: student._id,
      classId,
    });

    if (existing) {
      const classDetails = await classReadableDetails(classId);

      if (existing.status === "pending") {
        return res.status(200).json({
          message: "Request already pending",
          request: existing,
          classDetails,
        });
      }

      if (existing.status === "approved" && existing.isActive === true) {
        return res.status(200).json({
          message: "Already approved for this class",
          request: existing,
          classDetails,
        });
      }

      existing.studentName = snapName;
      existing.studentPhone = snapPhone;
      existing.status = "pending";
      existing.requestedAt = new Date();
      existing.approvedAt = null;
      existing.approvedBy = null;
      existing.isActive = true;
      await existing.save();

      return res.status(200).json({
        message: "Enrollment request sent again",
        request: existing,
        classDetails,
      });
    }

    const doc = await Enrollment.create({
      studentId: student._id,
      classId,
      studentName: snapName,
      studentPhone: snapPhone,
      status: "pending",
      requestedAt: new Date(),
      approvedAt: null,
      approvedBy: null,
      isActive: true,
    });

    const classDetails = await classReadableDetails(classId);

    return res.status(201).json({
      message: "Enrollment request sent",
      request: doc,
      classDetails,
    });
  } catch (err) {
    console.error("requestEnroll error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getMyEnrollRequests = async (req, res) => {
  try {
    const student = await User.findById(req.user?.id).lean();
    if (!student || student.role !== "student") {
      return res.status(403).json({ message: "Only students can view this" });
    }

    const list = await Enrollment.find({ studentId: student._id })
      .sort({ createdAt: -1 })
      .lean();

    const enriched = [];
    for (const r of list) {
      const classDetails = await classReadableDetails(r.classId);
      enriched.push({ ...r, classDetails });
    }

    return res.status(200).json({ requests: enriched });
  } catch (err) {
    console.error("getMyEnrollRequests error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getMyApprovedClasses = async (req, res) => {
  try {
    const student = await User.findById(req.user?.id).lean();

    if (!student || student.role !== "student") {
      return res.status(403).json({ message: "Only students can view this" });
    }

    const rows = await Enrollment.find({
      studentId: student._id,
      status: "approved",
      isActive: true,
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    const items = [];

    for (const row of rows) {
      const classDetails = await classReadableDetails(row.classId);
      if (!classDetails) continue;

      items.push({
        enrollId: row._id,
        classId: classDetails.classId,
        className: classDetails.className || "",
        batchNumber: classDetails.batchNumber || "",
        grade: classDetails.grade || "",
        gradeLabel: classDetails.gradeLabel || "",
        flowType: classDetails.flowType || "normal",
        level: classDetails.level || "",
        stream: classDetails.stream || "",
        streamLabel: classDetails.streamLabel || "",
        subject: classDetails.subject || "",
        imageUrl: classDetails.imageUrl || "",
        status: row.status,
        approvedAt: row.approvedAt,
      });
    }

    return res.status(200).json({ items });
  } catch (err) {
    console.error("getMyApprovedClasses error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getPendingEnrollRequestOptions = async (req, res) => {
  try {
    const pendingRows = await Enrollment.find({
      status: "pending",
      isActive: true,
    })
      .select("classId")
      .lean();

    const classIds = [
      ...new Set(pendingRows.map((r) => String(r.classId)).filter(Boolean)),
    ];

    if (!classIds.length) {
      return res.status(200).json({
        grades: [],
        subjects: [],
        batchNumbers: [],
      });
    }

    const classDocs = await ClassModel.find({
      _id: { $in: classIds },
      isActive: true,
    })
      .select(
        "_id gradeId subjectId streamId streamSubjectId alSubjectName alSubjectKey batchNumber"
      )
      .lean();

    const gradeIds = [
      ...new Set(classDocs.map((c) => String(c.gradeId)).filter(Boolean)),
    ];

    const gradeDocs = gradeIds.length
      ? await Grade.find({ _id: { $in: gradeIds }, isActive: true })
          .select("flowType grade subjects streams")
          .lean()
      : [];

    const gradeMap = new Map(gradeDocs.map((g) => [String(g._id), g]));

    const grades = [];
    const subjects = [];
    const batchNumbers = [];

    for (const cls of classDocs) {
      const gradeDoc = gradeMap.get(String(cls.gradeId));
      if (!gradeDoc) continue;

      const subjectName = getSubjectNameFromGrade(gradeDoc, cls);
      const gradeNumber = Number(gradeDoc?.grade || 0) || null;

      if (cls.batchNumber) {
        batchNumbers.push(String(cls.batchNumber).trim());
      }

      if (gradeNumber) {
        grades.push({
          value: String(gradeNumber),
          label:
            gradeDoc.flowType === "al"
              ? `A/L - Grade ${gradeNumber}`
              : `Grade ${gradeNumber}`,
        });
      }

      if (subjectName && subjectName !== "Unknown" && gradeNumber) {
        subjects.push({
          grade: String(gradeNumber),
          value: subjectName,
          label: subjectName,
        });
      }
    }

    const gradeSeen = new Set();
    const uniqueGrades = grades.filter((g) => {
      const key = String(g.value);
      if (gradeSeen.has(key)) return false;
      gradeSeen.add(key);
      return true;
    });

    const subjectSeen = new Set();
    const uniqueSubjects = subjects.filter((s) => {
      const key = `${String(s.grade)}-${normalizeKey(s.value)}`;
      if (subjectSeen.has(key)) return false;
      subjectSeen.add(key);
      return true;
    });

    const uniqueBatchNumbers = [...new Set(batchNumbers.filter(Boolean))].sort(
      (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })
    );

    uniqueGrades.sort((a, b) => Number(a.value) - Number(b.value));
    uniqueSubjects.sort((a, b) => {
      const gradeDiff = Number(a.grade) - Number(b.grade);
      if (gradeDiff !== 0) return gradeDiff;
      return String(a.label).localeCompare(String(b.label));
    });

    return res.status(200).json({
      grades: uniqueGrades,
      subjects: uniqueSubjects,
      batchNumbers: uniqueBatchNumbers.map((b) => ({
        value: b,
        label: `Batch ${b}`,
      })),
    });
  } catch (err) {
    console.error("getPendingEnrollRequestOptions error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getPendingEnrollRequests = async (req, res) => {
  try {
    const {
      grade = "",
      subject = "",
      phonenumber = "",
      batchNumber = "",
      page = "1",
      limit = "12",
    } = req.query || {};

    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.max(1, Math.min(50, Number(limit) || 12));

    const enrollmentQuery = {
      status: "pending",
      isActive: true,
    };

    if (phonenumber) {
      enrollmentQuery.studentPhone = {
        $regex: escapeRegex(String(phonenumber).trim()),
        $options: "i",
      };
    }

    const list = await Enrollment.find(enrollmentQuery)
      .sort({ createdAt: -1 })
      .lean();

    const enriched = [];
    for (const r of list) {
      const classDetails = await classReadableDetails(r.classId);
      if (!classDetails) continue;

      enriched.push({
        ...r,
        studentName: String(r.studentName || "").trim(),
        studentPhone: String(r.studentPhone || "").trim(),
        classDetails,
      });
    }

    let filtered = enriched;

    if (grade) {
      filtered = filtered.filter(
        (row) => Number(row?.classDetails?.grade || 0) === Number(grade)
      );
    }

    if (subject) {
      filtered = filtered.filter(
        (row) =>
          normalizeKey(row?.classDetails?.subject || "") === normalizeKey(subject)
      );
    }

    if (batchNumber) {
      filtered = filtered.filter(
        (row) =>
          String(row?.classDetails?.batchNumber || "").trim() ===
          String(batchNumber).trim()
      );
    }

    filtered.sort((a, b) => {
      const aGrade = Number(a?.classDetails?.grade || 0);
      const bGrade = Number(b?.classDetails?.grade || 0);
      if (aGrade !== bGrade) return aGrade - bGrade;

      const aSubject = String(a?.classDetails?.subject || "");
      const bSubject = String(b?.classDetails?.subject || "");
      if (aSubject !== bSubject) return aSubject.localeCompare(bSubject);

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = filtered.length;
    const start = (pageNumber - 1) * limitNumber;
    const rows = filtered.slice(start, start + limitNumber);

    return res.status(200).json({
      total,
      page: pageNumber,
      limit: limitNumber,
      requests: rows,
    });
  } catch (err) {
    console.error("getPendingEnrollRequests error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const approveEnrollRequest = async (req, res) => {
  try {
    const { enrollId } = req.params;

    if (!isValidId(enrollId)) {
      return res.status(400).json({ message: "Invalid enrollId" });
    }

    const doc = await Enrollment.findById(enrollId);
    if (!doc) return res.status(404).json({ message: "Request not found" });

    doc.status = "approved";
    doc.approvedAt = new Date();
    doc.approvedBy = req.user?.id || null;
    doc.isActive = true;

    await doc.save();

    const classDetails = await classReadableDetails(doc.classId);

    return res.status(200).json({
      message: "Enrollment approved",
      request: doc,
      classDetails,
    });
  } catch (err) {
    console.error("approveEnrollRequest error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const rejectEnrollRequest = async (req, res) => {
  try {
    const { enrollId } = req.params;

    if (!isValidId(enrollId)) {
      return res.status(400).json({ message: "Invalid enrollId" });
    }

    const doc = await Enrollment.findById(enrollId);
    if (!doc) return res.status(404).json({ message: "Request not found" });

    doc.status = "rejected";
    doc.approvedAt = null;
    doc.approvedBy = req.user?.id || null;
    doc.isActive = false;

    await doc.save();

    const classDetails = await classReadableDetails(doc.classId);

    return res.status(200).json({
      message: "Enrollment rejected",
      request: doc,
      classDetails,
    });
  } catch (err) {
    console.error("rejectEnrollRequest error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};