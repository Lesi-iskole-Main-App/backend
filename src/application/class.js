import mongoose from "mongoose";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import User from "../infastructure/schemas/user.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const norm = (v) => String(v || "").trim();

const validateTeachers = async (teacherIds) => {
  if (!Array.isArray(teacherIds)) {
    return { ok: false, code: 400, message: "teacherIds must be an array" };
  }

  if (teacherIds.length === 0) {
    return { ok: true };
  }

  for (const tid of teacherIds) {
    if (!isValidId(tid)) {
      return { ok: false, code: 400, message: `Invalid teacherId: ${tid}` };
    }

    const t = await User.findById(tid).lean();
    if (!t || t.role !== "teacher") {
      return { ok: false, code: 404, message: `Teacher not found: ${tid}` };
    }

    if (!t.isApproved) {
      return {
        ok: false,
        code: 403,
        message: `Teacher must be approved: ${tid}`,
      };
    }
  }

  return { ok: true };
};

const validateGradeRelation = async ({
  gradeId,
  subjectId,
  streamId,
  streamSubjectId,
}) => {
  const grade = await Grade.findById(gradeId).lean();
  if (!grade) return { ok: false, code: 404, message: "Grade not found" };

  if (grade.flowType === "normal") {
    if (!subjectId) {
      return {
        ok: false,
        code: 400,
        message: "subjectId is required for grades 1-11",
      };
    }

    if (!isValidId(subjectId)) {
      return {
        ok: false,
        code: 400,
        message: "Invalid subjectId",
      };
    }

    const validSubjectIds = new Set(
      (grade.subjects || []).map((s) => String(s._id))
    );

    if (!validSubjectIds.has(String(subjectId))) {
      return {
        ok: false,
        code: 400,
        message: "subjectId does not belong to this grade",
      };
    }

    return {
      ok: true,
      grade,
      mode: "normal",
      gradeNo: grade.grade,
      gradeLabel: `Grade ${grade.grade}`,
      subjectName:
        (grade.subjects || []).find((s) => String(s._id) === String(subjectId))
          ?.subject || "",
      streamName: "",
    };
  }

  if (grade.flowType === "al") {
    if (!streamId) {
      return {
        ok: false,
        code: 400,
        message: "streamId is required for A/L",
      };
    }

    if (!streamSubjectId) {
      return {
        ok: false,
        code: 400,
        message: "streamSubjectId is required for A/L",
      };
    }

    if (!isValidId(streamId)) {
      return {
        ok: false,
        code: 400,
        message: "Invalid streamId",
      };
    }

    if (!isValidId(streamSubjectId)) {
      return {
        ok: false,
        code: 400,
        message: "Invalid streamSubjectId",
      };
    }

    const streamObj = (grade.streams || []).find(
      (s) => String(s._id) === String(streamId)
    );

    if (!streamObj) {
      return {
        ok: false,
        code: 400,
        message: "streamId does not belong to A/L",
      };
    }

    const subjectObj = (streamObj.subjects || []).find(
      (s) => String(s._id) === String(streamSubjectId)
    );

    if (!subjectObj) {
      return {
        ok: false,
        code: 400,
        message: "streamSubjectId does not belong to this stream",
      };
    }

    return {
      ok: true,
      grade,
      mode: "al",
      gradeNo: null,
      gradeLabel: "A/L",
      streamName: streamObj.stream || "",
      subjectName: subjectObj.subject || "",
    };
  }

  return {
    ok: false,
    code: 400,
    message: "Unsupported grade flow",
  };
};

const buildClassResponse = (doc) => {
  const grade = doc?.gradeId;

  if (!grade) {
    return {
      ...doc,
      gradeNo: null,
      gradeLabel: "",
      streamName: "",
      subjectName: "",
    };
  }

  if (grade.flowType === "normal") {
    const subjectObj = (grade.subjects || []).find(
      (s) => String(s._id) === String(doc.subjectId)
    );

    return {
      ...doc,
      gradeNo: grade.grade,
      gradeLabel: `Grade ${grade.grade}`,
      streamName: "",
      subjectName: subjectObj?.subject || "Unknown",
    };
  }

  if (grade.flowType === "al") {
    const streamObj = (grade.streams || []).find(
      (s) => String(s._id) === String(doc.streamId)
    );

    const subjectObj = (streamObj?.subjects || []).find(
      (s) => String(s._id) === String(doc.streamSubjectId)
    );

    return {
      ...doc,
      gradeNo: null,
      gradeLabel: "A/L",
      streamName: streamObj?.stream || "Unknown",
      subjectName: subjectObj?.subject || "Unknown",
    };
  }

  return {
    ...doc,
    gradeNo: null,
    gradeLabel: "",
    streamName: "",
    subjectName: "",
  };
};

// CREATE CLASS
export const createClass = async (req, res) => {
  try {
    const {
      className,
      gradeId,
      subjectId = null,
      streamId = null,
      streamSubjectId = null,
      teacherIds = [],
      imageUrl = "",
      imagePublicId = "",
    } = req.body;

    if (!className || !gradeId) {
      return res
        .status(400)
        .json({ message: "className and gradeId are required" });
    }

    if (!isValidId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    const rel = await validateGradeRelation({
      gradeId,
      subjectId,
      streamId,
      streamSubjectId,
    });
    if (!rel.ok) return res.status(rel.code).json({ message: rel.message });

    const tchk = await validateTeachers(teacherIds);
    if (!tchk.ok) return res.status(tchk.code).json({ message: tchk.message });

    const payload = {
      className: norm(className),
      gradeId,
      teacherIds,
      imageUrl: String(imageUrl || "").trim(),
      imagePublicId: String(imagePublicId || "").trim(),
      createdBy: req.user?.id || null,
      subjectId: null,
      streamId: null,
      streamSubjectId: null,
    };

    if (rel.mode === "normal") {
      payload.subjectId = subjectId;
    } else {
      payload.streamId = streamId;
      payload.streamSubjectId = streamSubjectId;
    }

    const doc = await ClassModel.create(payload);

    return res.status(201).json({ message: "Class created", class: doc });
  } catch (err) {
    console.error("createClass error:", err);
    if (err.code === 11000) {
      return res.status(409).json({
        message:
          "Duplicate class (same className + grade + subject/stream subject)",
      });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET ALL CLASSES
export const getAllClass = async (req, res) => {
  try {
    const list = await ClassModel.find()
      .populate("gradeId", "grade flowType title subjects streams")
      .populate("teacherIds", "name email phonenumber isApproved role")
      .sort({ createdAt: -1 })
      .lean();

    const classes = list.map(buildClassResponse);

    return res.status(200).json({ classes });
  } catch (err) {
    console.error("getAllClass error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET CLASS BY ID
export const getClassById = async (req, res) => {
  try {
    const { classId } = req.params;
    if (!isValidId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const doc = await ClassModel.findById(classId)
      .populate("gradeId", "grade flowType title subjects streams")
      .populate("teacherIds", "name email phonenumber isApproved role")
      .lean();

    if (!doc) return res.status(404).json({ message: "Class not found" });

    return res.status(200).json({
      class: buildClassResponse(doc),
    });
  } catch (err) {
    console.error("getClassById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// UPDATE CLASS
export const updateClassById = async (req, res) => {
  try {
    const { classId } = req.params;
    if (!isValidId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const doc = await ClassModel.findById(classId);
    if (!doc) return res.status(404).json({ message: "Class not found" });

    const {
      className,
      gradeId,
      subjectId,
      streamId,
      streamSubjectId,
      teacherIds,
      isActive,
      imageUrl,
      imagePublicId,
    } = req.body;

    const newGradeId = gradeId !== undefined ? gradeId : doc.gradeId;
    const newSubjectId = subjectId !== undefined ? subjectId : doc.subjectId;
    const newStreamId = streamId !== undefined ? streamId : doc.streamId;
    const newStreamSubjectId =
      streamSubjectId !== undefined ? streamSubjectId : doc.streamSubjectId;

    if (!isValidId(newGradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    const rel = await validateGradeRelation({
      gradeId: newGradeId,
      subjectId: newSubjectId,
      streamId: newStreamId,
      streamSubjectId: newStreamSubjectId,
    });
    if (!rel.ok) return res.status(rel.code).json({ message: rel.message });

    if (teacherIds !== undefined) {
      const tchk = await validateTeachers(teacherIds);
      if (!tchk.ok) return res.status(tchk.code).json({ message: tchk.message });
      doc.teacherIds = teacherIds;
    }

    if (className !== undefined) doc.className = norm(className);
    if (gradeId !== undefined) doc.gradeId = newGradeId;
    if (isActive !== undefined) doc.isActive = Boolean(isActive);

    if (rel.mode === "normal") {
      doc.subjectId = newSubjectId;
      doc.streamId = null;
      doc.streamSubjectId = null;
    } else {
      doc.subjectId = null;
      doc.streamId = newStreamId;
      doc.streamSubjectId = newStreamSubjectId;
    }

    if (imageUrl !== undefined) doc.imageUrl = String(imageUrl || "").trim();
    if (imagePublicId !== undefined) {
      doc.imagePublicId = String(imagePublicId || "").trim();
    }

    await doc.save();

    return res.status(200).json({ message: "Class updated", class: doc });
  } catch (err) {
    console.error("updateClassById error:", err);
    if (err.code === 11000) {
      return res.status(409).json({
        message:
          "Duplicate class (same className + grade + subject/stream subject)",
      });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE CLASS
export const deleteClassById = async (req, res) => {
  try {
    const { classId } = req.params;
    if (!isValidId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const deleted = await ClassModel.findByIdAndDelete(classId);
    if (!deleted) return res.status(404).json({ message: "Class not found" });

    return res.status(200).json({ message: "Class deleted" });
  } catch (err) {
    console.error("deleteClassById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUBLIC
export const getClassesPublic = async (req, res) => {
  try {
    const gradeNumber = String(req.query.gradeNumber || "").trim();
    const subjectName = String(req.query.subjectName || "").trim();
    const streamName = String(req.query.streamName || "").trim();

    let gradeDoc = null;
    let query = { isActive: true };

    if (gradeNumber === "12" || gradeNumber === "13" || gradeNumber.toLowerCase() === "al") {
      gradeDoc = await Grade.findOne({
        flowType: "al",
        isActive: true,
      }).lean();

      if (!gradeDoc) {
        return res.status(404).json({ message: "A/L not found" });
      }

      query.gradeId = gradeDoc._id;

      let selectedStreamName = "";
      let selectedSubjectName = "";

      let streamObj = null;

      if (streamName) {
        streamObj = (gradeDoc.streams || []).find(
          (s) =>
            String(s?.stream || "").trim().toLowerCase() ===
            streamName.toLowerCase()
        );

        if (!streamObj) {
          return res.status(404).json({ message: "Stream not found in A/L" });
        }

        query.streamId = streamObj._id;
        selectedStreamName = streamObj.stream;
      }

      if (subjectName) {
        if (!streamObj) {
          return res.status(400).json({
            message: "streamName is required when filtering A/L subject",
          });
        }

        const subjectObj = (streamObj.subjects || []).find(
          (s) =>
            String(s?.subject || "").trim().toLowerCase() ===
            subjectName.toLowerCase()
        );

        if (!subjectObj) {
          return res.status(404).json({ message: "Subject not found in stream" });
        }

        query.streamSubjectId = subjectObj._id;
        selectedSubjectName = subjectObj.subject;
      }

      const list = await ClassModel.find(query)
        .populate("teacherIds", "name email phonenumber isApproved role")
        .sort({ createdAt: -1 })
        .lean();

      const classes = list.map((c) => {
        const st = (gradeDoc.streams || []).find(
          (s) => String(s._id) === String(c.streamId)
        );
        const sub = (st?.subjects || []).find(
          (s) => String(s._id) === String(c.streamSubjectId)
        );

        return {
          _id: c._id,
          className: c.className,
          gradeLabel: "A/L",
          streamName: st?.stream || selectedStreamName || "",
          subjectName: sub?.subject || selectedSubjectName || "",
          imageUrl: c.imageUrl || "",
          teacherCount: Array.isArray(c.teacherIds) ? c.teacherIds.length : 0,
          teachers: (c.teacherIds || []).map((t) => ({
            _id: t._id,
            name: t.name,
          })),
          createdAt: c.createdAt,
        };
      });

      return res.status(200).json({ classes });
    }

    const gradeNo = Number(gradeNumber);
    if (!gradeNo || gradeNo < 1 || gradeNo > 11) {
      return res.status(400).json({ message: "gradeNumber must be 1-11 or 12/13/al" });
    }

    gradeDoc = await Grade.findOne({
      flowType: "normal",
      grade: gradeNo,
      isActive: true,
    }).lean();

    if (!gradeDoc) {
      return res.status(404).json({ message: "Grade not found" });
    }

    query.gradeId = gradeDoc._id;

    let selectedSubjectName = "";

    if (subjectName) {
      const subjectObj = (gradeDoc.subjects || []).find(
        (s) =>
          String(s?.subject || "").trim().toLowerCase() ===
          subjectName.toLowerCase()
      );

      if (!subjectObj) {
        return res.status(404).json({ message: "Subject not found in this grade" });
      }

      query.subjectId = subjectObj._id;
      selectedSubjectName = subjectObj.subject;
    }

    const list = await ClassModel.find(query)
      .populate("teacherIds", "name email phonenumber isApproved role")
      .sort({ createdAt: -1 })
      .lean();

    const classes = list.map((c) => {
      const sub = (gradeDoc.subjects || []).find(
        (s) => String(s._id) === String(c.subjectId)
      );

      return {
        _id: c._id,
        className: c.className,
        gradeLabel: `Grade ${gradeNo}`,
        streamName: "",
        subjectName: sub?.subject || selectedSubjectName || "",
        imageUrl: c.imageUrl || "",
        teacherCount: Array.isArray(c.teacherIds) ? c.teacherIds.length : 0,
        teachers: (c.teacherIds || []).map((t) => ({
          _id: t._id,
          name: t.name,
        })),
        createdAt: c.createdAt,
      };
    });

    return res.status(200).json({ classes });
  } catch (err) {
    console.error("getClassesPublic error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};