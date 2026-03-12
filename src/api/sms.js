import axios from "axios";

const SMSLENZ_URL = "https://smslenz.lk/api/send-sms";

const normalizeSmsPhone = (phone = "") => {
  const raw = String(phone || "").trim();

  if (!raw) return "";
  if (raw.startsWith("+94")) return raw;
  if (raw.startsWith("94")) return `+${raw}`;
  if (raw.startsWith("0")) return `+94${raw.slice(1)}`;

  return raw;
};

export const sendSMS = async (contact, message) => {
  const user_id = process.env.SMSLENZ_USER_ID;
  const api_key = process.env.SMSLENZ_API_KEY;
  const sender_id = process.env.SMSLENZ_SENDER_ID || "SMSlenzDEMO";

  if (!user_id || !api_key || !sender_id) {
    throw new Error(
      "SMSlenz env missing. Please set SMSLENZ_USER_ID, SMSLENZ_API_KEY, SMSLENZ_SENDER_ID"
    );
  }

  const cleanContact = normalizeSmsPhone(contact);

  if (!cleanContact) {
    throw new Error("SMS contact number is required");
  }

  const payload = {
    user_id,
    api_key,
    sender_id,
    contact: cleanContact,
    message: String(message || "").trim(),
  };

  const { data } = await axios.post(SMSLENZ_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 30000,
  });

  console.log("==========================================");
  console.log("[SMSLENZ] Payload:", payload);
  console.log("[SMSLENZ] Response:", data);
  console.log("==========================================");

  const successValue = data?.success;
  const messageValue = String(data?.message || "").toLowerCase();
  const statusValue = String(data?.data?.status || "").toLowerCase();

  const isSuccess =
    successValue === true ||
    successValue === "true" ||
    messageValue.includes("success") ||
    statusValue === "success";

  if (!isSuccess) {
    throw new Error(data?.message || "SMS sending failed");
  }

  return data;
};