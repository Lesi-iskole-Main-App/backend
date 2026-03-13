import mongoose from "mongoose";
import Grade, { AL_STREAM_ENUM } from "../infastructure/schemas/grade.js";

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(String(id || ""));

const toStr = (x) => String(x || "").trim();
const toKey = (x) => String(x || "").trim().toLowerCase();
const normalizeALStream = (value) => toKey(value).replace(/\s+/g, "_");

const AL_STREAM_LABELS = {
  physical_science: "Physical Science",
  biological_science: "Biological Science",
  commerce: "Commerce",
  arts: "Arts",
  technology: "Technology",
  common: "Common",
};

const attachStreamLabels = (streams = []) =>
  streams.map((s) => ({
    ...(typeof s?.toObject === "function" ? s.toObject() : s),
    label: AL_STREAM_LABELS[s?.stream] || s?.stream,
  }));

const normalizeLegacyALDocInMemory = (gradeDoc) => {
  if (!gradeDoc || gradeDoc.flowType !== "al") return gradeDoc;

  const existingMap = new Map(
    (gradeDoc.streams || []).map((s) => [normalizeALStream(s.stream), s])
  );

  const rebuilt = AL_STREAM_ENUM.map((streamName) => {
    const existing = existingMap.get(streamName);

    if (existing) {
      existing.stream = streamName;
      existing.subjects = Array.isArray(existing.subjects) ? existing.subjects : [];
      return existing;
    }

    return {
      stream: streamName,
      subjects: [],
    };
  });

  gradeDoc.streams = rebuilt;
  gradeDoc.subjects = [];

  if (!gradeDoc.title) {
    gradeDoc.title =
      gradeDoc.grade && (gradeDoc.grade === 12 || gradeDoc.grade === 13)
        ? `Grade ${gradeDoc.grade}`
        : "A/L";
  }

  return gradeDoc;
};

const buildSafeGradeResponse = (gradeDoc) => {
  if (!gradeDoc) return null;

  const obj =
    typeof gradeDoc.toObject === "function" ? gradeDoc.toObject() : { ...gradeDoc };

  if (obj.flowType === "al") {
    obj.subjects = [];
    obj.streams = attachStreamLabels(
      Array.isArray(obj.streams) ? obj.streams : []
    );
  }

  return obj;
};

const mergeALStreamsFromGrades = (gradeDocs = []) => {
  const map = new Map();

  for (const streamName of AL_STREAM_ENUM) {
    map.set(streamName, {
      _id: `al-${streamName}`,
      stream: streamName,
      label: AL_STREAM_LABELS[streamName] || streamName,
      gradeNumbers: [],
      subjects: [],
    });
  }

  for (const gradeDoc of gradeDocs) {
    normalizeLegacyALDocInMemory(gradeDoc);

    for (const st of gradeDoc.streams || []) {
      const key = normalizeALStream(st?.stream);
      if (!map.has(key)) continue;

      const target = map.get(key);

      if (
        Number.isInteger(gradeDoc?.grade) &&
        !target.gradeNumbers.includes(gradeDoc.grade)
      ) {
        target.gradeNumbers.push(gradeDoc.grade);
      }

      const existingSubjectKeys = new Set(
        (target.subjects || []).map((sub) => toKey(sub.subject))
      );

      for (const sub of st?.subjects || []) {
        const subjectName = toStr(sub?.subject);
        const subjectKey = toKey(subjectName);
        if (!subjectKey || existingSubjectKeys.has(subjectKey)) continue;

        target.subjects.push({
          _id: sub?._id || new mongoose.Types.ObjectId(),
          subject: subjectName,
        });

        existingSubjectKeys.add(subjectKey);
      }
    }
  }

  return Array.from(map.values())
    .filter((s) => s.gradeNumbers.length > 0 || s.subjects.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
};

/* =========================================================
   ADMIN: Grades
========================================================= */

export const createGrade = async (req, res) => {
  try {
    const rawGrade = req.body?.grade;
    const flowTypeInput = toKey(req.body?.flowType);
    const gradeNumber = Number(rawGrade);

    const wantsAL =
      flowTypeInput === "al" || gradeNumber === 12 || gradeNumber === 13;

    const wantsNormal =
      flowTypeInput === "normal" ||
      (Number.isInteger(gradeNumber) && gradeNumber >= 1 && gradeNumber <= 11);

    if (!wantsAL && !wantsNormal) {
      return res.status(400).json({
        message: "grade must be between 1 and 13",
      });
    }

    if (wantsAL && !(gradeNumber === 12 || gradeNumber === 13)) {
      return res.status(400).json({
        message: "A/L grades must be 12 or 13",
      });
    }

    if (wantsNormal && !(gradeNumber >= 1 && gradeNumber <= 11)) {
      return res.status(400).json({
        message: "Normal grades must be between 1 and 11",
      });
    }

    const finalFlowType = wantsAL ? "al" : "normal";

    const exists = await Grade.findOne({
      flowType: finalFlowType,
      grade: gradeNumber,
    });

    if (exists) {
      return res.status(409).json({
        message: "Grade already exists",
        grade: buildSafeGradeResponse(exists),
      });
    }

    const grade = await Grade.create({
      flowType: finalFlowType,
      grade: gradeNumber,
      title: `Grade ${gradeNumber}`,
      subjects: [],
      streams:
        finalFlowType === "al"
          ? AL_STREAM_ENUM.map((stream) => ({
              stream,
              subjects: [],
            }))
          : [],
      isActive: true,
      createdBy: req.user?.id || null,
    });

    return res.status(201).json({ grade: buildSafeGradeResponse(grade) });
  } catch (err) {
    console.error("createGrade error:", err);

    if (err?.code === 11000) {
      return res.status(409).json({ message: "Grade already exists" });
    }

    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateGradeById = async (req, res) => {
  try {
    const { gradeId } = req.params;

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (typeof req.body?.isActive === "boolean") {
      grade.isActive = req.body.isActive;
    }

    if (grade.flowType === "al") {
      normalizeLegacyALDocInMemory(grade);
    }

    await grade.save();

    return res.status(200).json({ grade: buildSafeGradeResponse(grade) });
  } catch (err) {
    console.error("updateGradeById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteGradeById = async (req, res) => {
  try {
    const { gradeId } = req.params;

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    const deleted = await Grade.findByIdAndDelete(gradeId);
    if (!deleted) return res.status(404).json({ message: "Grade not found" });

    return res.status(200).json({ message: "Grade deleted" });
  } catch (err) {
    console.error("deleteGradeById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   ADMIN: Subjects (Grades 1..11)
========================================================= */

export const getSubjectsByGrade = async (req, res) => {
  try {
    const { gradeId } = req.params;

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "normal") {
      return res
        .status(400)
        .json({ message: "This endpoint is only for grades 1-11" });
    }

    return res.status(200).json({ subjects: grade.subjects || [] });
  } catch (err) {
    console.error("getSubjectsByGrade error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createSubject = async (req, res) => {
  try {
    const gradeId = req.body?.gradeId;
    const subject = toStr(req.body?.subject);

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    if (!subject) {
      return res.status(400).json({ message: "subject is required" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "normal") {
      return res
        .status(400)
        .json({ message: "Subjects here are only allowed for grades 1-11" });
    }

    const dup = (grade.subjects || []).some(
      (s) => toStr(s.subject).toLowerCase() === subject.toLowerCase()
    );

    if (dup) {
      return res.status(409).json({ message: "Subject already exists" });
    }

    grade.subjects.push({ subject });
    await grade.save();

    return res.status(201).json({ subjects: grade.subjects });
  } catch (err) {
    console.error("createSubject error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateSubjectById = async (req, res) => {
  try {
    const { gradeId, subjectId } = req.params;
    const subject = toStr(req.body?.subject);

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({ message: "Invalid subjectId" });
    }

    if (!subject) {
      return res.status(400).json({ message: "subject is required" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "normal") {
      return res
        .status(400)
        .json({ message: "This endpoint is only for grades 1-11" });
    }

    const sub = (grade.subjects || []).id(subjectId);
    if (!sub) return res.status(404).json({ message: "Subject not found" });

    const dup = (grade.subjects || []).some(
      (s) =>
        String(s._id) !== String(subjectId) &&
        toStr(s.subject).toLowerCase() === subject.toLowerCase()
    );

    if (dup) {
      return res.status(409).json({ message: "Subject already exists" });
    }

    sub.subject = subject;
    await grade.save();

    return res.status(200).json({ subjects: grade.subjects });
  } catch (err) {
    console.error("updateSubjectById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteSubjectById = async (req, res) => {
  try {
    const { gradeId, subjectId } = req.params;

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({ message: "Invalid subjectId" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "normal") {
      return res
        .status(400)
        .json({ message: "This endpoint is only for grades 1-11" });
    }

    const sub = (grade.subjects || []).id(subjectId);
    if (!sub) return res.status(404).json({ message: "Subject not found" });

    sub.deleteOne();
    await grade.save();

    return res.status(200).json({ subjects: grade.subjects });
  } catch (err) {
    console.error("deleteSubjectById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   ADMIN: A/L Streams (READ ONLY PREDEFINED)
========================================================= */

export const getStreamsByGradeId = async (req, res) => {
  try {
    const { gradeId } = req.params;

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "al") {
      return res
        .status(400)
        .json({ message: "Streams are only available for A/L grades" });
    }

    normalizeLegacyALDocInMemory(grade);

    return res.status(200).json({
      streams: attachStreamLabels(grade.streams || []),
    });
  } catch (err) {
    console.error("getStreamsByGradeId error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createStream = async (req, res) => {
  return res.status(400).json({
    message: "A/L streams are predefined. You cannot create streams manually.",
  });
};

export const updateStreamById = async (req, res) => {
  return res.status(400).json({
    message: "A/L streams are predefined. You cannot edit stream names.",
  });
};

export const deleteStreamById = async (req, res) => {
  return res.status(400).json({
    message: "A/L streams are predefined. You cannot delete streams.",
  });
};

/* =========================================================
   ADMIN: A/L Stream Subjects
========================================================= */

export const getStreamSubjects = async (req, res) => {
  try {
    const { gradeId, streamId } = req.params;

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    if (!isValidObjectId(streamId)) {
      return res.status(400).json({ message: "Invalid streamId" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "al") {
      return res
        .status(400)
        .json({ message: "Stream subjects are only for A/L grades" });
    }

    normalizeLegacyALDocInMemory(grade);

    const st = (grade.streams || []).id(streamId);
    if (!st) return res.status(404).json({ message: "Stream not found" });

    return res.status(200).json({ subjects: st.subjects || [] });
  } catch (err) {
    console.error("getStreamSubjects error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createStreamSubject = async (req, res) => {
  try {
    const gradeId = req.body?.gradeId;
    const streamId = req.body?.streamId;
    const subject = toStr(req.body?.subject);

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    if (!isValidObjectId(streamId)) {
      return res.status(400).json({ message: "Invalid streamId" });
    }

    if (!subject) {
      return res.status(400).json({ message: "subject is required" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "al") {
      return res
        .status(400)
        .json({ message: "Stream subjects are only allowed for A/L" });
    }

    normalizeLegacyALDocInMemory(grade);

    const st = (grade.streams || []).id(streamId);
    if (!st) return res.status(404).json({ message: "Stream not found" });

    const dup = (st.subjects || []).some(
      (s) => toStr(s.subject).toLowerCase() === subject.toLowerCase()
    );

    if (dup) {
      return res
        .status(409)
        .json({ message: "Subject already exists in this stream" });
    }

    st.subjects.push({ subject });
    await grade.save();

    return res.status(201).json({ subjects: st.subjects });
  } catch (err) {
    console.error("createStreamSubject error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateStreamSubjectById = async (req, res) => {
  try {
    const { gradeId, streamId, subjectId } = req.params;
    const subject = toStr(req.body?.subject);

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    if (!isValidObjectId(streamId)) {
      return res.status(400).json({ message: "Invalid streamId" });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({ message: "Invalid subjectId" });
    }

    if (!subject) {
      return res.status(400).json({ message: "subject is required" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "al") {
      return res
        .status(400)
        .json({ message: "Stream subjects are only for A/L" });
    }

    normalizeLegacyALDocInMemory(grade);

    const st = (grade.streams || []).id(streamId);
    if (!st) return res.status(404).json({ message: "Stream not found" });

    const sub = (st.subjects || []).id(subjectId);
    if (!sub) {
      return res.status(404).json({ message: "Stream subject not found" });
    }

    const dup = (st.subjects || []).some(
      (s) =>
        String(s._id) !== String(subjectId) &&
        toStr(s.subject).toLowerCase() === subject.toLowerCase()
    );

    if (dup) {
      return res
        .status(409)
        .json({ message: "Subject already exists in this stream" });
    }

    sub.subject = subject;
    await grade.save();

    return res.status(200).json({ subjects: st.subjects });
  } catch (err) {
    console.error("updateStreamSubjectById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteStreamSubjectById = async (req, res) => {
  try {
    const { gradeId, streamId, subjectId } = req.params;

    if (!isValidObjectId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    if (!isValidObjectId(streamId)) {
      return res.status(400).json({ message: "Invalid streamId" });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({ message: "Invalid subjectId" });
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    if (grade.flowType !== "al") {
      return res
        .status(400)
        .json({ message: "Stream subjects are only for A/L" });
    }

    normalizeLegacyALDocInMemory(grade);

    const st = (grade.streams || []).id(streamId);
    if (!st) return res.status(404).json({ message: "Stream not found" });

    const sub = (st.subjects || []).id(subjectId);
    if (!sub) {
      return res.status(404).json({ message: "Stream subject not found" });
    }

    sub.deleteOne();
    await grade.save();

    return res.status(200).json({ subjects: st.subjects });
  } catch (err) {
    console.error("deleteStreamSubjectById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   PUBLIC
========================================================= */

export const getGradesPublic = async (req, res) => {
  try {
    const grades = await Grade.find({ isActive: true }).sort({ flowType: 1, grade: 1 });

    const safeGrades = grades.map((g) => {
      if (g.flowType === "al") {
        normalizeLegacyALDocInMemory(g);
      }
      return buildSafeGradeResponse(g);
    });

    return res.status(200).json({ grades: safeGrades });
  } catch (err) {
    console.error("getGradesPublic error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getGradeDetailPublic = async (req, res) => {
  try {
    const raw = String(req.params.gradeNumber || "").trim();
    const gradeNumber = Number(raw);

    if (!Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 13) {
      return res.status(400).json({ message: "Invalid grade number" });
    }

    const flowType = gradeNumber >= 12 ? "al" : "normal";

    const gradeDoc = await Grade.findOne({
      flowType,
      grade: gradeNumber,
      isActive: true,
    });

    if (!gradeDoc) return res.status(404).json({ message: "Grade not found" });

    if (gradeDoc.flowType === "al") {
      normalizeLegacyALDocInMemory(gradeDoc);
    }

    return res.status(200).json({ grade: buildSafeGradeResponse(gradeDoc) });
  } catch (err) {
    console.error("getGradeDetailPublic error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getStreamsSmart = async (req, res) => {
  try {
    const value = String(req.params.value || "").trim().toLowerCase();

    if (value === "al") {
      const alGrades = await Grade.find({
        flowType: "al",
        isActive: true,
      }).sort({ grade: 1 });

      if (!alGrades.length) {
        return res.status(404).json({ message: "A/L grades not found" });
      }

      const streams = mergeALStreamsFromGrades(alGrades);

      return res.status(200).json({ streams });
    }

    if (isValidObjectId(value)) {
      const gradeDoc = await Grade.findById(value);
      if (!gradeDoc) return res.status(404).json({ message: "Grade not found" });

      if (gradeDoc.flowType !== "al") {
        return res.status(200).json({ streams: [] });
      }

      normalizeLegacyALDocInMemory(gradeDoc);

      return res.status(200).json({
        streams: attachStreamLabels(gradeDoc.streams || []),
      });
    }

    const gradeNumber = Number(value);

    if (!Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 13) {
      return res.status(400).json({ message: "Invalid grade value" });
    }

    if (gradeNumber >= 1 && gradeNumber <= 11) {
      const gradeDoc = await Grade.findOne({
        flowType: "normal",
        grade: gradeNumber,
        isActive: true,
      });

      if (!gradeDoc) return res.status(404).json({ message: "Grade not found" });

      return res.status(200).json({ streams: [] });
    }

    const gradeDoc = await Grade.findOne({
      flowType: "al",
      grade: gradeNumber,
      isActive: true,
    });

    if (!gradeDoc) {
      return res.status(404).json({ message: "A/L grade not found" });
    }

    normalizeLegacyALDocInMemory(gradeDoc);

    return res.status(200).json({
      streams: attachStreamLabels(gradeDoc.streams || []),
    });
  } catch (err) {
    console.error("getStreamsSmart error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};