import mongoose from "mongoose";
import TeacherAssignment from "../infastructure/schemas/teacherAssignment.js";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import Paper, { PAPER_TYPES } from "../infastructure/schemas/paper.js";
import PaperAttempt from "../infastructure/schemas/paperAttempt.js";
import User from "../infastructure/schemas/user.js";

const toId = (v) => String(v || "").trim();

const uniqueValues = (arr = []) => {
  return [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))];
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

/**
 * ✅ EXACT SAME formula as src/application/rank.js
 * Returns Map(studentIdString -> islandRankNumber)
 *
 * IMPORTANT:
 * - This uses $setWindowFields (MongoDB 5.0+ required)
 * - Ranking is GLOBAL (across all students), then filtered to given studentIds
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
    // ✅ only completed attempts + only free/paid (exclude practise)
    {
      $match: {
        status: "submitted",
        submittedAt: { $ne: null },
        paymentType: { $in: ["free", "paid"] },
      },
    },

    // ✅ best attempt per (studentId+paperId) by points then percentage then submittedAt
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

    // ✅ sum per student
    {
      $group: {
        _id: "$studentId",
        totalCoins: { $sum: { $ifNull: ["$totalPointsEarned", 0] } },
        totalFinishedExams: { $sum: 1 },
        lastSubmittedAt: { $max: "$submittedAt" },
      },
    },

    // ✅ build single numeric score
    {
      $addFields: {
        lastTime: { $toLong: { $ifNull: ["$lastSubmittedAt", new Date(0)] } },
      },
    },
    {
      $addFields: {
        score: {
          $add: [
            { $multiply: ["$totalCoins", 1000000000000000] }, // 1e15
            { $multiply: ["$totalFinishedExams", 1000000000000] }, // 1e12
            "$lastTime",
          ],
        },
      },
    },

    { $sort: { score: -1 } },

    // ✅ dense rank
    {
      $setWindowFields: {
        sortBy: { score: -1 },
        output: {
          rank: { $denseRank: {} },
        },
      },
    },

    // ✅ keep only the students we need (AFTER ranking, so ranks remain global)
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

export const getTeachersAssignedResultReport = async (req, res, next) => {
  try {
    const teacherId = toId(req.user?.id);
    if (!teacherId) return res.status(401).json({ message: "Unauthorized" });

    const queryPaperType = String(req.query?.paperType || "Daily Quiz").trim();
    const querySubject = String(req.query?.subject || "").trim();

    // 1) teacher assignment
    const teacherAssignment = await TeacherAssignment.findOne({ teacherId }).lean();

    if (!teacherAssignment) {
      return res.status(200).json({
        message: "No teacher assignment found",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: [] },
        reports: [],
      });
    }

    const assignments = Array.isArray(teacherAssignment.assignments)
      ? teacherAssignment.assignments
      : [];

    const allowedGradeIds = uniqueValues(assignments.map((a) => a?.gradeId));
    const allowedSubjectIds = uniqueValues(assignments.flatMap((a) => a?.subjectIds || []));

    if (!allowedGradeIds.length || !allowedSubjectIds.length) {
      return res.status(200).json({
        message: "No assigned grade or subject found",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: [] },
        reports: [],
      });
    }

    // 2) teacher classes
    const teacherClasses = await ClassModel.find({
      teacherIds: teacherId,
      gradeId: { $in: allowedGradeIds },
      subjectId: { $in: allowedSubjectIds },
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

    // 3) grade docs
    const gradeDocs = await Grade.find({
      _id: { $in: uniqueValues(teacherClasses.map((c) => c?.gradeId)) },
    }).lean();

    const gradeMap = new Map(gradeDocs.map((g) => [toId(g._id), g]));

    // 4) papers for assigned grade+subject, paperType filter
    const paperFilter = {
      gradeId: { $in: allowedGradeIds },
      subjectId: { $in: allowedSubjectIds },
      isActive: true,
    };
    if (queryPaperType) paperFilter.paperType = queryPaperType;

    const papers = await Paper.find(paperFilter).lean();

    const subjectOptions = uniqueValues(
      papers.map((p) => {
        const g = gradeMap.get(toId(p.gradeId));
        return getSubjectNameFromGrade(g, p.subjectId);
      })
    ).sort((a, b) => a.localeCompare(b));

    if (!papers.length) {
      return res.status(200).json({
        message: "No papers found",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: subjectOptions },
        reports: [],
      });
    }

    // 5) filter papers by subject NAME
    let paperIds = papers.map((p) => toId(p._id));
    if (querySubject) {
      const key = querySubject.toLowerCase();
      paperIds = papers
        .filter((p) => {
          const g = gradeMap.get(toId(p.gradeId));
          const sName = getSubjectNameFromGrade(g, p.subjectId);
          return String(sName || "").trim().toLowerCase() === key;
        })
        .map((p) => toId(p._id));
    }

    if (!paperIds.length) {
      return res.status(200).json({
        message: "No results found",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: subjectOptions },
        reports: [],
      });
    }

    // 6) attempts for those papers (for building modal breakdown)
    const attempts = await PaperAttempt.find({
      paperId: { $in: paperIds },
      status: "submitted",
    }).lean();

    if (!attempts.length) {
      return res.status(200).json({
        message: "No results found",
        total: 0,
        filters: { paperTypes: PAPER_TYPES, subjects: subjectOptions },
        reports: [],
      });
    }

    // 7) student names (only for those attempts)
    const studentIds = uniqueValues(attempts.map((a) => a.studentId));
    const students = await User.find({ _id: { $in: studentIds } })
      .select("_id name")
      .lean();
    const studentMap = new Map(students.map((s) => [toId(s._id), String(s.name || "").trim()]));

    // ✅ 8) GLOBAL Island Rank using YOUR formula
    let islandRankMap = new Map();
    try {
      islandRankMap = await buildIslandRankMapForStudents(studentIds);
    } catch (err) {
      // If MongoDB < 5.0, it will fail. Keep rank "-" but don’t crash.
      console.error("Island rank aggregate failed:", err?.message || err);
      islandRankMap = new Map();
    }

    // 9) paper map
    const paperMap = new Map(papers.map((p) => [toId(p._id), p]));

    // 10) build rows by student
    const byStudent = new Map();

    for (const a of attempts) {
      const paperId = toId(a.paperId);
      const studentId = toId(a.studentId);

      const paper = paperMap.get(paperId);
      if (!paper) continue;

      const gradeDoc = gradeMap.get(toId(paper.gradeId));
      const gradeNumber = Number(gradeDoc?.grade || 0);
      const gradeLabel = gradeNumber ? `Grade ${String(gradeNumber).padStart(2, "0")}` : "-";
      const subjectName = getSubjectNameFromGrade(gradeDoc, paper.subjectId) || "-";

      const studentName = studentMap.get(studentId) || "-";
      const islandRank = islandRankMap.get(studentId) || 0;

      if (!byStudent.has(studentId)) {
        byStudent.set(studentId, {
          id: studentId,
          studentName,
          grade: gradeLabel,
          subject: subjectName,
          paperType: String(paper.paperType || "").trim(),
          islandRank: islandRank ? Number(islandRank) : "-", // ✅ MAIN TABLE rank
          resultBreakdown: [],
        });
      }

      // modal breakdown (no island rank in modal)
      byStudent.get(studentId).resultBreakdown.push({
        title: String(paper.paperTitle || "").trim() || "Paper",
        correctAnswers: Number(a.correctCount || 0),
        marks: Number(a.totalPointsEarned || 0),
        progress: `${Number(a.percentage || 0).toFixed(0)}%`,
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

    // match your rank.js helpful message
    if (String(err?.message || "").includes("$setWindowFields")) {
      return res.status(500).json({
        message:
          "MongoDB does not support ranking ($setWindowFields). Upgrade MongoDB to 5.0+ (Atlas is OK).",
      });
    }

    next(err);
  }
};