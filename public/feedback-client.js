/* Shared feedback API client for Transformation Agency apps. Exports to window. */

const PILLAR_PRESS_DEFAULT_FEEDBACK_API_BASE = "https://project-cw1bz.vercel.app";

function pillarPressFeedbackApiBase() {
  const value = (
    window.PILLAR_PRESS_FEEDBACK_API_BASE ||
    window.PILLAR_FEEDBACK_API_BASE ||
    window.PRISM_FEEDBACK_API_BASE ||
    PILLAR_PRESS_DEFAULT_FEEDBACK_API_BASE
  );
  return String(value || PILLAR_PRESS_DEFAULT_FEEDBACK_API_BASE).replace(/\/$/, "");
}

async function pillarPressSafeJson(response) {
  try {
    return await response.json();
  } catch (e) {
    return null;
  }
}

async function submitPillarPressFeedback(payload) {
  const response = await fetch(pillarPressFeedbackApiBase() + "/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const data = await pillarPressSafeJson(response);
  if (!response.ok) {
    return {
      success: false,
      error: (data && data.error) || "Feedback could not be submitted.",
    };
  }
  return Object.assign({ success: true }, data || {});
}

Object.assign(window, {
  pillarPressFeedbackApiBase,
  submitPillarPressFeedback,
});
