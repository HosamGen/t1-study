/*
 * Study configuration — the only file you normally edit before launch.
 *
 * Study link to paste into Prolific: one Prolific study per set, 16 in total.
 *   U1 and U3: S1-S4 of 25 questions (1-25, 26-50, 51-75, 76-100, ids in sorted order).
 *   U2: S1-S8 alternating 12 and 13 questions (1-12, 13-25, 26-37, ... 88-100). Sizes: tools/build_data.py SET_SIZES.
 *   https://<your-host>/?study=U2-S1&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
 *
 * Testing links (no PROLIFIC_PID = preview mode, nothing is sent to the server unless save.savePreview is true):
 *   ?study=U1-S1                full set 1 of U1
 *   ?part=U2&ids=h294           one question (pilot)
 *   ?study=U3-S2&q=7            jump straight to question 7 (preview only)
 *   ?study=U1-S1&q=0            jump straight to the sample question (preview only)
 *   add &reset=1 to forget saved progress in this browser
 */
window.STUDY_CONFIG = {
  title: "Urban design photo study",

  // Folder that holds u1.json, u2.json, u3.json (built by tools/build_data.py).
  dataBase: "data/",

  // ---- Where answers are saved -------------------------------------------------------------
  // method: "datapipe" -> DataPipe (https://pipe.jspsych.org), stores one JSON file per participant in Google Drive
  //         "post"     -> POST the JSON (as text/plain) to postUrl, e.g. a Google Apps Script web app
  //         "none"     -> nothing is sent (testing only)
  save: {
    method: "none",
    datapipeExperimentId: "",
    postUrl: "",
    savePreview: false, // true = also send answers from preview links (no PROLIFIC_PID)
  },

  // ---- Prolific ----------------------------------------------------------------------------
  prolific: {
    completionUrl: "https://app.prolific.com/submissions/complete?cc=",
    // Looked up in this order: the set (e.g. "U2-S3"), then the part ("U2"), then "default".
    // Give every Prolific study a custom completion code that matches this table.
    completionCodes: {
      default: "CN6CG3TL", // from the Prolific "Default" completion path; add "U1-S1": "..." etc. if studies get different codes
    },
    autoRedirectSeconds: 5, // 0 = no automatic redirect, only the button
  },

  showExample: true, // sample question with the correct answer shown (data/examples.json), between the instructions and question 1
  collapseAfter: 5, // "About the photos" (and U2's "How to answer") are open on questions 1-5, then collapsed (click to show)
  shuffleQuestions: false, // true = per-participant order (seeded by PROLIFIC_PID); default keeps id order
  minViewportWidth: 1000, // narrower windows see a "please use a computer" warning on the welcome page

  // Optional information sheet / consent text (HTML). Empty = no consent checkbox.
  consentHtml: "",

  // ---- Participant-facing text -------------------------------------------------------------
  // The per-part instructions page text lives in data/u*.json ("instructions"), copied verbatim
  // from the question files; U1's is a draft written in tools/build_data.py.
  welcome: {
    intro:
      "In this study you will look at photos of real places taken before and/or after an urban design project, " +
      "for example a new park entrance, a redesigned street or a renovated station square. " +
      "Numbered yellow boxes are drawn on the photos.",
    task: {
      U1: "For each question you will read a short project brief that states one priority of the project, then select every numbered box whose change serves that priority.",
      U2: "For each question you will read a short project brief with a list of objectives and assign each numbered box to the objective its change serves.",
      U3: "For each question you will read a short project brief that states one objective, then select every numbered box the project would have to change to achieve it.",
    },
    closing: "Use only the photos and the text shown to answer each question.",
  },
  endText: "Thank you for completing this survey.",
};
