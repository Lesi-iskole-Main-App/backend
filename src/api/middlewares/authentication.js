import jwt from "jsonwebtoken";
import User from "../../infastructure/schemas/user.js";

const normalizeOrigin = (value) =>
  String(value || "")
    .trim()
    .replace(/\/$/, "");

const splitOrigins = (value) =>
  String(value || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

const frontendOrigins = [
  ...splitOrigins(process.env.FRONTEND_URL),
  ...splitOrigins(process.env.LOCAL_WEB_URL),
  "http://localhost:5173",
  "http://localhost:8081",
];

const adminOrigins = [
  ...splitOrigins(process.env.ADMIN_URL),
  ...splitOrigins(process.env.LOCAL_ADMIN_URL),
  "http://localhost:5174",
];

const teacherOrigins = [
  ...splitOrigins(process.env.TEACHER_URL),
  ...splitOrigins(process.env.LOCAL_TEACHER_URL),
  "http://localhost:5175",
];

const originCookieNames = new Map([
  ...frontendOrigins.map((origin) => [normalizeOrigin(origin), "student_token"]),
  ...adminOrigins.map((origin) => [normalizeOrigin(origin), "admin_token"]),
  ...teacherOrigins.map((origin) => [normalizeOrigin(origin), "teacher_token"]),
]);

const getRequestOrigin = (req) => {
  const origin = normalizeOrigin(req.get("origin"));
  if (origin) return origin;

  const referer = req.get("referer");
  if (!referer) return "";

  try {
    return normalizeOrigin(new URL(referer).origin);
  } catch {
    return "";
  }
};

const getBearerToken = (req) => {
  const authHeader = String(req.headers.authorization || "");

  if (!authHeader.startsWith("Bearer ")) return "";

  return authHeader.slice(7).trim();
};

const getTokenCandidates = (req) => {
  const requestOrigin = getRequestOrigin(req);
  const scopedCookieName = originCookieNames.get(requestOrigin);

  const scopedCookieToken = scopedCookieName
    ? req.cookies?.[scopedCookieName]
    : "";

  const bearerToken = getBearerToken(req);
  const genericCookieToken = req.cookies?.token || "";

  const candidates = scopedCookieName
    ? [scopedCookieToken, bearerToken, genericCookieToken]
    : [bearerToken, genericCookieToken];

  // If Origin is unavailable, accept a scoped cookie only when exactly one
  // scoped login exists. This avoids selecting the wrong website account.
  if (!scopedCookieName && !bearerToken && !genericCookieToken) {
    const scopedTokens = [
      req.cookies?.student_token,
      req.cookies?.admin_token,
      req.cookies?.teacher_token,
    ].filter(Boolean);

    if (scopedTokens.length === 1) {
      candidates.push(scopedTokens[0]);
    }
  }

  return [...new Set(candidates.filter(Boolean))];
};

export const authenticate = async (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error("Authentication configuration error: JWT_SECRET is missing");
      return res.status(500).json({
        message: "Server authentication configuration error",
      });
    }

    const tokenCandidates = getTokenCandidates(req);

    if (tokenCandidates.length === 0) {
      return res.status(401).json({ message: "Missing token" });
    }

    let decoded = null;

    // Try the website-specific cookie first, then Bearer and legacy cookie.
    for (const token of tokenCandidates) {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        break;
      } catch {
        // Continue so a stale legacy token cannot block a valid scoped token.
      }
    }

    if (!decoded) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const userId = decoded?.id || decoded?._id || decoded?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const user = await User.findById(userId).lean();

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: "User is inactive" });
    }

    req.user = {
      id: String(user._id),
      role: String(user.role || "")
        .toLowerCase()
        .trim(),
      isApproved: Boolean(user.isApproved),
    };

    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(401).json({ message: "Invalid token" });
  }
};

