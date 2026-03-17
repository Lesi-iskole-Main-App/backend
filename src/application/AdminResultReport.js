import mongoose from "mongoose";
import User from "../infastructure/schemas/user.js";
import Grade from "../infastructure/schemas/grade.js";
import Paper from "../infastructure/schemas/paper.js";
import PaperAttempt from "../infastructure/schemas/paperAttempt.js";

const DEFAULT_PAPER_TYPE = "Daily Quiz";
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const toId = (value) => String(value || "").trim();

const uniqueValues = (arr = []) => {
  return [...new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))];
};

const formatGradeLabel = (gradeNumber) => {
  const num = Number(gradeNumber || 0);
  if (!num) return "";
  return `Grade ${String(num).padStart(2, "0")}`;
};

const formatPercentage = (value) => {
  const num = Number(value || 0);
  return `${num}%`;
};

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const getSubjectAndStreamFromGrade = (gradeDoc, paper) => {
  if (!gradeDoc) {
    return { subject: "", stream: "" };
  }

  const normalSubjects = Array.isArray(gradeDoc.subjects) ? gradeDoc.subjects : [];
  const streams = Array.isArray(gradeDoc.streams) ? gradeDoc.streams : [];

  if (paper?.subjectId) {
    const normalFound = normalSubjects.find(
      (s) => toId(s?._id) === toId(paper.subjectId)
    );
    if (normalFound?.subject) {
      return {
        subject: String(normalFound.subject || "").trim(),
        stream: "",
      };
    }
  }

  if (paper?.streamSubjectId || paper?.streamId) {
    for (const streamItem of streams) {
      const streamName = String(streamItem?.stream || "").trim();
      const streamSubjects = Array.isArray(streamItem?.subjects)
        ? streamItem.subjects
        : [];

      if (paper?.streamSubjectId) {
        const found = streamSubjects.find(
          (s) => toId(s?._id) === toId(paper.streamSubjectId)
        );
        if (found?.subject) {
          return {
            subject: String(found.subject || "").trim(),
            stream: streamName,
          };
        }
      }

      if (paper?.streamId && toId(streamItem?._id) === toId(paper.streamId)) {
        return {
          subject: "",
          stream: streamName,
        };
      }
    }
  }

  return { subject: "", stream: "" };
};

const isBetterAttempt = (nextAttempt, currentBest) => {
  if (!currentBest) return true;

  const nextPercentage = Number(nextAttempt?.percentage || 0);
  const currentPercentage = Number(currentBest?.percentage || 0);

  if (nextPercentage > currentPercentage) return true;
  if (nextPercentage < currentPercentage) return false;

  const nextMarks = Number(nextAttempt?.totalPointsEarned || 0);
  const currentMarks = Number(currentBest?.totalPointsEarned || 0);

  if (nextMarks > currentMarks) return true;
  if (nextMarks < currentMarks) return false;

  const nextSubmitted = new Date(
    nextAttempt?.submittedAt || nextAttempt?.updatedAt || 0
  ).getTime();
  const currentSubmitted = new Date(
    currentBest?.submittedAt || currentBest?.updatedAt || 0
  ).getTime();

  return nextSubmitted > currentSubmitted;
};

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
    {
      $project: {
        studentId: { $toString: "$_id" },
        rank: 1,
      },
    },
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

export const getAdminResultReport = async (req, res, next) => {
  try {
    const {
      paperType = DEFAULT_PAPER_TYPE,
      grade = "",
      stream = "",
      subject = "",
      completedPaperCount = "",
      page = DEFAULT_PAGE,
      limit = DEFAULT_LIMIT,
    } = req.query;

    const safePage = Math.max(1, Number(page) || DEFAULT_PAGE);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || DEFAULT_LIMIT));

    const allPapers = await Paper.find({ isActive: true })
      .select(
        "_id paperType paperTitle gradeId subjectId streamId streamSubjectId"
      )
      .lean();

    if (!allPapers.length) {
      return res.status(200).json({
        message: "No papers found",
        total: 0,
        filters: {
          paperTypes: [],
          grades: [],
          streams: [],
          subjects: [],
        },
        pagination: {
          page: safePage,
          limit: safeLimit,
          totalRows: 0,
          totalPages: 1,
        },
        rows: [],
      });
    }

    const gradeIds = uniqueValues(allPapers.map((p) => p.gradeId));
    const gradeDocs = await Grade.find({ _id: { $in: gradeIds } }).lean();
    const gradeMap = new Map(gradeDocs.map((g) => [toId(g._id), g]));

    const enrichedPapers = allPapers.map((paper) => {
      const gradeDoc = gradeMap.get(toId(paper.gradeId));
      const { subject: subjectName, stream: streamName } =
        getSubjectAndStreamFromGrade(gradeDoc, paper);

      return {
        _id: toId(paper._id),
        paperType: String(paper.paperType || "").trim(),
        paperName: String(paper.paperTitle || "").trim(),
        grade: formatGradeLabel(gradeDoc?.grade),
        stream: String(streamName || "").trim(),
        subject: String(subjectName || "").trim(),
      };
    });

    const filterPaperTypes = uniqueValues(enrichedPapers.map((p) => p.paperType)).sort(
      (a, b) => a.localeCompare(b)
    );

    const filterGrades = uniqueValues(enrichedPapers.map((p) => p.grade)).sort((a, b) => {
      const na = Number(String(a).replace(/\D/g, ""));
      const nb = Number(String(b).replace(/\D/g, ""));
      return na - nb;
    });

    const filterStreams = uniqueValues(enrichedPapers.map((p) => p.stream)).sort((a, b) =>
      a.localeCompare(b)
    );

    const filterSubjects = uniqueValues(enrichedPapers.map((p) => p.subject)).sort((a, b) =>
      a.localeCompare(b)
    );

    let filteredPapers = [...enrichedPapers];

    if (paperType) {
      filteredPapers = filteredPapers.filter(
        (p) => normalizeText(p.paperType) === normalizeText(paperType)
      );
    }

    if (grade) {
      filteredPapers = filteredPapers.filter(
        (p) => normalizeText(p.grade) === normalizeText(grade)
      );
    }

    if (stream) {
      filteredPapers = filteredPapers.filter(
        (p) => normalizeText(p.stream) === normalizeText(stream)
      );
    }

    if (subject) {
      filteredPapers = filteredPapers.filter(
        (p) => normalizeText(p.subject) === normalizeText(subject)
      );
    }

    if (!filteredPapers.length) {
      return res.status(200).json({
        message: "No matching papers found",
        total: 0,
        filters: {
          paperTypes: filterPaperTypes,
          grades: filterGrades,
          streams: filterStreams,
          subjects: filterSubjects,
        },
        pagination: {
          page: safePage,
          limit: safeLimit,
          totalRows: 0,
          totalPages: 1,
        },
        rows: [],
      });
    }

    const filteredPaperIds = filteredPapers.map((p) => p._id);
    const filteredPaperMap = new Map(filteredPapers.map((p) => [p._id, p]));

    const attempts = await PaperAttempt.find({
      paperId: { $in: filteredPaperIds },
      status: "submitted",
    })
      .select(
        "paperId studentId questionCount totalPossiblePoints totalPointsEarned correctCount percentage submittedAt updatedAt paymentType"
      )
      .lean();

    if (!attempts.length) {
      return res.status(200).json({
        message: "No result records found",
        total: 0,
        filters: {
          paperTypes: filterPaperTypes,
          grades: filterGrades,
          streams: filterStreams,
          subjects: filterSubjects,
        },
        pagination: {
          page: safePage,
          limit: safeLimit,
          totalRows: 0,
          totalPages: 1,
        },
        rows: [],
      });
    }

    const studentPaperBestMap = new Map();

    for (const attempt of attempts) {
      const key = `${toId(attempt.studentId)}__${toId(attempt.paperId)}`;

      if (!studentPaperBestMap.has(key)) {
        studentPaperBestMap.set(key, {
          studentId: toId(attempt.studentId),
          paperId: toId(attempt.paperId),
          bestAttempt: null,
        });
      }

      const current = studentPaperBestMap.get(key);

      if (isBetterAttempt(attempt, current.bestAttempt)) {
        current.bestAttempt = attempt;
      }
    }

    const studentIds = uniqueValues(
      [...studentPaperBestMap.values()].map((item) => item.studentId)
    );

    const students = await User.find({
      _id: { $in: studentIds },
      role: "student",
    })
      .select("name selectedGradeNumber selectedStream")
      .lean();

    const studentMap = new Map(
      students.map((s) => [
        toId(s._id),
        {
          name: String(s.name || "").trim(),
          grade: formatGradeLabel(s.selectedGradeNumber),
          stream: String(s.selectedStream || "").trim(),
        },
      ])
    );

    let islandRankMap = new Map();
    try {
      islandRankMap = await buildIslandRankMapForStudents(studentIds);
    } catch (err) {
      console.error("AdminResultReport island rank error:", err?.message || err);
      islandRankMap = new Map();
    }

    const groupedByStudent = new Map();

    for (const item of studentPaperBestMap.values()) {
      const student = studentMap.get(item.studentId);
      const paper = filteredPaperMap.get(item.paperId);
      const best = item.bestAttempt;

      if (!student || !paper || !best) continue;

      if (!groupedByStudent.has(item.studentId)) {
        const rank = Number(islandRankMap.get(item.studentId) || 0);

        groupedByStudent.set(item.studentId, {
          id: item.studentId,
          studentId: item.studentId,
          studentName: student.name || "-",
          grade: student.grade || paper.grade || "-",
          stream: student.stream || paper.stream || "-",
          islandRank: rank ? rank : "-",
          subjects: [],
          completedPapersCount: 0,
          freePaperCount: 0,
          paidPaperCount: 0,
          results: [],
          highestScore: 0,
        });
      }

      const group = groupedByStudent.get(item.studentId);

      if (paper.subject) {
        group.subjects.push(paper.subject);
      }

      group.completedPapersCount += 1;

      const payType = normalizeText(best.paymentType);
      if (payType === "free") group.freePaperCount += 1;
      if (payType === "paid") group.paidPaperCount += 1;

      group.results.push({
        paperName: paper.paperName || "-",
        subject: paper.subject || "-",
        grade: paper.grade || "-",
        stream: paper.stream || "-",
        paperType: paper.paperType || "-",
        paymentType: payType || "-",
        correctAnswers: Number(best.correctCount || 0),
        marks: Number(best.totalPointsEarned || 0),
        progress: formatPercentage(best.percentage),
        percentageValue: Number(best.percentage || 0),
      });

      if (Number(best.percentage || 0) > group.highestScore) {
        group.highestScore = Number(best.percentage || 0);
      }
    }

    let rows = [...groupedByStudent.values()].map((row) => ({
      ...row,
      subjects: uniqueValues(row.subjects).sort((a, b) => a.localeCompare(b)),
      results: [...row.results].sort((a, b) => {
        const byPercentage =
          Number(b.percentageValue || 0) - Number(a.percentageValue || 0);
        if (byPercentage !== 0) return byPercentage;
        return String(a.paperName || "").localeCompare(String(b.paperName || ""));
      }),
    }));

    if (completedPaperCount) {
      const wanted = Number(completedPaperCount);
      if (!Number.isNaN(wanted)) {
        rows = rows.filter(
          (r) => Number(r.completedPapersCount || 0) === Number(wanted)
        );
      }
    }

    rows = rows.sort((a, b) => {
      const byScore = Number(b.highestScore || 0) - Number(a.highestScore || 0);
      if (byScore !== 0) return byScore;

      const ar = a.islandRank === "-" ? Number.MAX_SAFE_INTEGER : Number(a.islandRank || 0);
      const br = b.islandRank === "-" ? Number.MAX_SAFE_INTEGER : Number(b.islandRank || 0);
      if (ar !== br) return ar - br;

      return String(a.studentName || "").localeCompare(String(b.studentName || ""));
    });

    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / safeLimit));
    const startIndex = (safePage - 1) * safeLimit;
    const paginatedRows = rows.slice(startIndex, startIndex + safeLimit);

    return res.status(200).json({
      message: "",
      total: totalRows,
      filters: {
        paperTypes: filterPaperTypes,
        grades: filterGrades,
        streams: filterStreams,
        subjects: filterSubjects,
      },
      pagination: {
        page: safePage,
        limit: safeLimit,
        totalRows,
        totalPages,
      },
      rows: paginatedRows,
    });
  } catch (err) {
    console.error("getAdminResultReport error:", err);

    if (String(err?.message || "").includes("$setWindowFields")) {
      return res.status(500).json({
        message:
          "MongoDB does not support ranking ($setWindowFields). Upgrade MongoDB to 5.0+.",
      });
    }

    next(err);
  }
};