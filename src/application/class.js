import mongoose from "mongoose";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import User from "../infastructure/schemas/user.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const norm = (v) => String(v || "").trim();
const is1to11 = (g) => g >= 1 && g <= 11;
const is12to13 = (g) => g >= 12 && g <= 13;

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

  const gradeNo = Number(grade.grade);

  // grade 1-11 => subjectId only
  if (is1to11(gradeNo)) {
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
      gradeNo,
      mode: "normal",
      subjectName:
        (grade.subjects || []).find((s) => String(s._id) === String(subjectId))
          ?.subject || "",
    };
  }

  // grade 12-13 => streamId + streamSubjectId
  if (is12to13(gradeNo)) {
    if (!streamId) {
      return {
        ok: false,
        code: 400,
        message: "streamId is required for grades 12-13",
      };
    }

    if (!streamSubjectId) {
      return {
        ok: false,
        code: 400,
        message: "streamSubjectId is required for grades 12-13",
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
        message: "streamId does not belong to this grade",
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
      gradeNo,
      mode: "al",
      streamName: streamObj.stream || "",
      subjectName: subjectObj.subject || "",
    };
  }

  return {
    ok: false,
    code: 400,
    message: "Unsupported grade",
  };
};

const buildClassResponse = (doc) => {
  const grade = doc?.gradeId;
  const gradeNo = Number(grade?.grade);

  if (!grade) {
    return {
      ...doc,
      gradeNo: null,
      streamName: "",
      subjectName: "",
    };
  }

  if (is1to11(gradeNo)) {
    const subjectObj = (grade.subjects || []).find(
      (s) => String(s._id) === String(doc.subjectId)
    );

    return {
      ...doc,
      gradeNo,
      streamName: "",
      subjectName: subjectObj?.subject || "Unknown",
    };
  }

  if (is12to13(gradeNo)) {
    const streamObj = (grade.streams || []).find(
      (s) => String(s._id) === String(doc.streamId)
    );

    const subjectObj = (streamObj?.subjects || []).find(
      (s) => String(s._id) === String(doc.streamSubjectId)
    );

    return {
      ...doc,
      gradeNo,
      streamName: streamObj?.stream || "Unknown",
      subjectName: subjectObj?.subject || "Unknown",
    };
  }

  return {
    ...doc,
    gradeNo,
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
      .populate("gradeId", "grade subjects streams")
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
      .populate("gradeId", "grade subjects streams")
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
    const gradeNumber = Number(req.query.gradeNumber);
    const subjectName = String(req.query.subjectName || "").trim();
    const streamName = String(req.query.streamName || "").trim();

    if (!gradeNumber || gradeNumber < 1 || gradeNumber > 13) {
      return res.status(400).json({ message: "gradeNumber must be 1-13" });
    }

    const gradeDoc = await Grade.findOne({
      grade: gradeNumber,
      isActive: true,
    }).lean();

    if (!gradeDoc) {
      return res.status(404).json({ message: "Grade not found" });
    }

    const query = {
      gradeId: gradeDoc._id,
      isActive: true,
    };

    let selectedStreamName = "";
    let selectedSubjectName = "";

    if (is1to11(gradeNumber)) {
      if (streamName) {
        return res
          .status(400)
          .json({ message: "streamName is not allowed for grades 1-11" });
      }

      if (subjectName) {
        const subjectObj = (gradeDoc.subjects || []).find(
          (s) =>
            String(s?.subject || "").trim().toLowerCase() ===
            subjectName.toLowerCase()
        );

        if (!subjectObj) {
          return res
            .status(404)
            .json({ message: "Subject not found in this grade" });
        }

        query.subjectId = subjectObj._id;
        selectedSubjectName = subjectObj.subject;
      }
    }

    if (is12to13(gradeNumber)) {
      let streamObj = null;

      if (streamName) {
        streamObj = (gradeDoc.streams || []).find(
          (s) =>
            String(s?.stream || "").trim().toLowerCase() ===
            streamName.toLowerCase()
        );

        if (!streamObj) {
          return res
            .status(404)
            .json({ message: "Stream not found in this grade" });
        }

        query.streamId = streamObj._id;
        selectedStreamName = streamObj.stream;
      }

      if (subjectName) {
        if (!streamObj) {
          return res.status(400).json({
            message: "streamName is required when filtering subject for grades 12-13",
          });
        }

        const subjectObj = (streamObj.subjects || []).find(
          (s) =>
            String(s?.subject || "").trim().toLowerCase() ===
            subjectName.toLowerCase()
        );

        if (!subjectObj) {
          return res
            .status(404)
            .json({ message: "Subject not found in this stream" });
        }

        query.streamSubjectId = subjectObj._id;
        selectedSubjectName = subjectObj.subject;
      }
    }

    const list = await ClassModel.find(query)
      .populate("teacherIds", "name email phonenumber isApproved role")
      .sort({ createdAt: -1 })
      .lean();

    const classes = list.map((c) => {
      let finalStreamName = "";
      let finalSubjectName = "";

      if (is1to11(gradeNumber)) {
        const subjectObj = (gradeDoc.subjects || []).find(
          (s) => String(s._id) === String(c.subjectId)
        );
        finalSubjectName = subjectObj?.subject || selectedSubjectName || "";
      } else {
        const streamObj = (gradeDoc.streams || []).find(
          (s) => String(s._id) === String(c.streamId)
        );
        const subjectObj = (streamObj?.subjects || []).find(
          (s) => String(s._id) === String(c.streamSubjectId)
        );

        finalStreamName = streamObj?.stream || selectedStreamName || "";
        finalSubjectName = subjectObj?.subject || selectedSubjectName || "";
      }

      return {
        _id: c._id,
        className: c.className,
        gradeNumber,
        streamName: finalStreamName,
        subjectName: finalSubjectName,
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