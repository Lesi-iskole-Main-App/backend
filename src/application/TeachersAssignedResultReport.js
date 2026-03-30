

















import mongoose from "mongoose";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import Paper, { PAPER_TYPES } from "../infastructure/schemas/paper.js";
import PaperAttempt from "../infastructure/schemas/paperAttempt.js";
import User from "../infastructure/schemas/user.js";

const toId = (v) => String(v || "").trim();

const uniqueValues = (arr = []) => {
  return [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))];
};

const AL_STREAM_LABELS = {
  physical_science: "Physical Science",
  biological_science: "Biological Science",
  commerce: "Commerce",
  arts: "Arts",
  technology: "Technology",
  common: "Common",
};

const normalizeKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const normalizeSubjectKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getStreamLabel = (value = "") => {
  const key = normalizeKey(value);
  return AL_STREAM_LABELS[key] || value || "";
};

const getSubjectNameFromGrade = (gradeDoc, subjectId) => {
  if (!gradeDoc || !subjectId) return "";

  const subjects = Array.isArray(gradeDoc.subjects) ? gradeDoc.subjects : [];
  const normal = subjects.find((s) => toId(s?._id) === toId(subjectId));
  if (normal?.subject) return String(normal.subject).trim();

  const streams = Array.isArray(gradeDoc.streams) ? gradeDoc.streams : [];
  for (const stream of streams) {
    const streamSubjects = Array.isArray(stream?.subjects) ? stream.subjects : [];
    const found = streamSubjects.find((s) => toId(s?._id) === toId(subjectId));
    if (found?.subject) return String(found.subject).trim();
  }

  return "";
};

const getPaperSubjectDisplay = (paper, gradeDoc) => {
  if (!paper || !gradeDoc) return "";

  if (gradeDoc.flowType === "normal") {
    return getSubjectNameFromGrade(gradeDoc, paper.subjectId);
  }

  const streamDoc = (gradeDoc.streams || []).find(
    (s) => toId(s?._id) === toId(paper.streamId)
  );

  const streamLabel = getStreamLabel(streamDoc?.stream || "");

  const subjectDoc = (streamDoc?.subjects || []).find(
    (s) => toId(s?._id) === toId(paper.streamSubjectId)
  );

  const subjectName = String(subjectDoc?.subject || "").trim();

  return [streamLabel, subjectName].filter(Boolean).join(" - ");
};

const getPaperSubjectOnly = (paper, gradeDoc) => {
  if (!paper || !gradeDoc) return "";

  if (gradeDoc.flowType === "normal") {
    return getSubjectNameFromGrade(gradeDoc, paper.subjectId);
  }

  const streamDoc = (gradeDoc.streams || []).find(
    (s) => toId(s?._id) === toId(paper.streamId)
  );

  const subjectDoc = (streamDoc?.subjects || []).find(
    (s) => toId(s?._id) === toId(paper.streamSubjectId)
  );

  return String(subjectDoc?.subject || "").trim();
};

const getGradeLabel = (gradeDoc) => {
  if (!gradeDoc) return "";
  if (gradeDoc.flowType === "al") return "A/L";
  return `Grade ${String(gradeDoc.grade).padStart(2, "0")}`;
};

/**
 * same global island rank logic you already had
 */
const buildIslandRankMapForStudents = async (studentIdStrings = []) => {
  const ids = (studentIdStrings || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  if (!ids.length) return new Map();

  const objectIds = ids
    .map((id) => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!objectIds.length) return new Map();

  const pipeline = [
    {
      $match: {
        status: "submitted",
        submittedAt: { $ne: null },
        paymentType: { $in: ["free", "paid"] },
      },
    },
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
    {
      $group: {
        _id: "$studentId",
        totalCoins: { $sum: { $ifNull: ["$totalPointsEarned", 0] } },
        totalFinishedExams: { $sum: 1 },
        lastSubmittedAt: { $max: "$submittedAt" },
      },
    },
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
    { $match: { _id: { $in: objectIds } } },
    { $project: { studentId: { $toString: "$_id" }, rank: 1 } },
  ];

  const out = await PaperAttempt.aggregate(pipeline);

  const map = new Map();
  for (const row of out || []) {
    const sid = String(row?.studentId || "").trim();
    const r = Number(row?.rank || 0);
    if (sid) map.set(sid, r || 0);
  }

  return map;
};

const buildTeacherClassRules = (classes = [], gradeMap = new Map()) => {
  const normalRules = [];
  const alRules = [];

  for (const cls of classes) {
    const gradeDoc = gradeMap.get(toId(cls.gradeId));
    if (!gradeDoc) continue;

    if (gradeDoc.flowType === "normal") {
      if (!cls.subjectId) continue;

      normalRules.push({
        gradeId: toId(cls.gradeId),
        subjectId: toId(cls.subjectId),
      });
      continue;
    }

    const gradeId = toId(cls.gradeId);

    if (cls.alSubjectName) {
      const subjectKey = normalizeSubjectKey(cls.alSubjectName);

      const streamIds = Array.isArray(cls.streamIds)
        ? cls.streamIds.map((x) => toId(x))
        : [];

      const matchedStreams = (gradeDoc.streams || []).filter((s) =>
        streamIds.includes(toId(s._id))
      );

      for (const stream of matchedStreams) {
        const subjectDoc = (stream.subjects || []).find(
          (s) => normalizeSubjectKey(s?.subject) === subjectKey
        );

        if (!subjectDoc) continue;

        alRules.push({
          gradeId,
          streamId: toId(stream._id),
          streamSubjectId: toId(subjectDoc._id),
        });
      }

      continue;
    }

    if (cls.streamId && cls.streamSubjectId) {
      alRules.push({
        gradeId,
        streamId: toId(cls.streamId),
        streamSubjectId: toId(cls.streamSubjectId),
      });
    }
  }

  const seenNormal = new Set();
  const uniqueNormalRules = normalRules.filter((r) => {
    const key = `${r.gradeId}__${r.subjectId}`;
    if (seenNormal.has(key)) return false;
    seenNormal.add(key);
    return true;
  });

  const seenAL = new Set();
  const uniqueALRules = alRules.filter((r) => {
    const key = `${r.gradeId}__${r.streamId}__${r.streamSubjectId}`;
    if (seenAL.has(key)) return false;
    seenAL.add(key);
    return true;
  });

  return { normalRules: uniqueNormalRules, alRules: uniqueALRules };
};

export const getTeachersAssignedResultReport = async (req, res, next) => {
  try {
    const teacherId = toId(req.user?.id);
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const teacher = await User.findById(teacherId)
      .select("_id role isApproved isActive")
      .lean();

    if (!teacher || teacher.role !== "teacher") {
      return res.status(403).json({ message: "Teacher access only" });
    }

    if (teacher.isApproved === false) {
      return res.status(403).json({ message: "Teacher not approved yet" });
    }

    if (teacher.isActive === false) {
      return res.status(403).json({ message: "Teacher account disabled" });
    }

    const queryPaperType = String(req.query?.paperType || "Daily Quiz").trim();
    const querySubject = String(req.query?.subject || "").trim().toLowerCase();

    // ✅ IMPORTANT:
    // Teacher web should use directly assigned classes from class.teacherIds
    const teacherClasses = await ClassModel.find({
      teacherIds: teacherId,
      isActive: true,
    }).lean();

    if (!teacherClasses.length) {
      return res.status(200).json({
        message: "No classes found for teacher",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: [] },
        reports: [],
      });
    }

    const gradeIds = uniqueValues(teacherClasses.map((c) => c?.gradeId));
    const gradeDocs = await Grade.find({
      _id: { $in: gradeIds },
      isActive: true,
    }).lean();

    const gradeMap = new Map(gradeDocs.map((g) => [toId(g._id), g]));

    const { normalRules, alRules } = buildTeacherClassRules(teacherClasses, gradeMap);

    if (!normalRules.length && !alRules.length) {
      return res.status(200).json({
        message: "No valid class subject relations found for teacher",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: [] },
        reports: [],
      });
    }

    const paperOr = [];

    for (const rule of normalRules) {
      paperOr.push({
        gradeId: rule.gradeId,
        subjectId: rule.subjectId,
        isActive: true,
      });
    }

    for (const rule of alRules) {
      paperOr.push({
        gradeId: rule.gradeId,
        streamId: rule.streamId,
        streamSubjectId: rule.streamSubjectId,
        isActive: true,
      });
    }

    const paperFilter = {
      $or: paperOr,
    };

    if (queryPaperType) {
      paperFilter.paperType = queryPaperType;
    }

    const papers = await Paper.find(paperFilter).lean();

    const subjectOptions = uniqueValues(
      papers
        .map((p) => {
          const g = gradeMap.get(toId(p.gradeId));
          return getPaperSubjectDisplay(p, g);
        })
        .filter(Boolean)
    ).sort((a, b) => a.localeCompare(b));

    if (!papers.length) {
      return res.status(200).json({
        message: "No papers found",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: subjectOptions },
        reports: [],
      });
    }

    let filteredPapers = papers;

    if (querySubject) {
      filteredPapers = papers.filter((p) => {
        const g = gradeMap.get(toId(p.gradeId));
        const subjectDisplay = String(getPaperSubjectDisplay(p, g) || "").trim().toLowerCase();
        const subjectOnly = String(getPaperSubjectOnly(p, g) || "").trim().toLowerCase();

        return (
          subjectDisplay === querySubject ||
          subjectOnly === querySubject
        );
      });
    }

    if (!filteredPapers.length) {
      return res.status(200).json({
        message: "No results found",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: subjectOptions },
        reports: [],
      });
    }

    const paperIds = filteredPapers.map((p) => toId(p._id));

    const attempts = await PaperAttempt.find({
      paperId: { $in: paperIds },
      status: "submitted",
      submittedAt: { $ne: null },
    }).lean();

    if (!attempts.length) {
      return res.status(200).json({
        message: "No results found",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: subjectOptions },
        reports: [],
      });
    }

    const studentIds = uniqueValues(attempts.map((a) => a.studentId));
    const students = await User.find({ _id: { $in: studentIds } })
      .select("_id name")
      .lean();

    const studentMap = new Map(
      students.map((s) => [toId(s._id), String(s.name || "").trim()])
    );

    let islandRankMap = new Map();
    try {
      islandRankMap = await buildIslandRankMapForStudents(studentIds);
    } catch (err) {
      console.error("Island rank aggregate failed:", err?.message || err);
      islandRankMap = new Map();
    }

    const filteredPaperMap = new Map(filteredPapers.map((p) => [toId(p._id), p]));

    const byStudent = new Map();

    for (const attempt of attempts) {
      const paper = filteredPaperMap.get(toId(attempt.paperId));
      if (!paper) continue;

      const studentId = toId(attempt.studentId);
      const gradeDoc = gradeMap.get(toId(paper.gradeId));

      const gradeLabel = getGradeLabel(gradeDoc) || "-";
      const subjectName = getPaperSubjectDisplay(paper, gradeDoc) || "-";
      const studentName = studentMap.get(studentId) || "-";
      const islandRank = islandRankMap.get(studentId) || 0;

      if (!byStudent.has(studentId)) {
        byStudent.set(studentId, {
          id: studentId,
          studentName,
          grade: gradeLabel,
          subject: subjectName,
          paperType: String(paper.paperType || "").trim(),
          islandRank: islandRank ? Number(islandRank) : "-",
          resultBreakdown: [],
        });
      }

      byStudent.get(studentId).resultBreakdown.push({
        title: String(paper.paperTitle || "").trim() || "Paper",
        correctAnswers: Number(attempt.correctCount || 0),
        marks: Number(attempt.totalPointsEarned || 0),
        progress: `${Number(attempt.percentage || 0).toFixed(0)}%`,
      });
    }

    const reports = Array.from(byStudent.values()).sort((a, b) =>
      String(a.studentName || "").localeCompare(String(b.studentName || ""))
    );

    return res.status(200).json({
      message: "Teachers assigned result report fetched successfully",
      total: reports.length,
      filters: {
        paperTypes: PAPER_TYPES,
        subjects: subjectOptions,
      },
      reports,
    });
  } catch (err) {
    console.error("getTeachersAssignedResultReport error:", err);

    if (String(err?.message || "").includes("$setWindowFields")) {
      return res.status(500).json({
        message:
          "MongoDB does not support ranking ($setWindowFields). Upgrade MongoDB to 5.0+ (Atlas is OK).",
      });
    }

    next(err);
  }
};