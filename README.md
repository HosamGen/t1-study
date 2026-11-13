# Urban design photo study (U1 / U2 / U3) — survey site for Prolific

A static website (plain HTML/CSS/JS, no build step, no server code). It shows the photos on the left and the
question on the right. The page never scrolls on a computer screen. In U2 the photos stay put while the
participant steps through the boxes. Photos are placed side by side or one above the other, whichever shows them
larger in the window: wide panoramas go top/bottom, near-square photos go side by side. The "Image 1: BEFORE" /
"Image 2: AFTER" labels move beside the photos when that makes the photos bigger.

Flow: welcome → **instructions and sample question** on one page (the right panel starts with the instructions;
scrolling down shows the sample's brief, its correct answer with the answer boxes framed in green on the photos,
an explanation for every box, and a confirmation the participant must tick) → 25 questions → completion page →
back to Prolific. The Instructions button at the top right reopens the instructions on every page.

| File | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | the survey |
| `config.js` | **the file to edit**: where answers are saved, completion codes, welcome/consent/end text |
| `data/u1.json`, `u2.json`, `u3.json` | 100 questions per part, split into sets (U1/U3: 4 × 25, U2: 8 × 12/13), built from the public question files |
| `data/examples.json`, `examples/` | the sample question for each part (text, answer, per-box explanation, box positions) |
| `tools/build_data.py` | rebuilds `data/u*.json` from a clone of `HosamGen/t1-study-assets` |
| `tools/collect.py` | turns saved participant files into the `responses/*.jsonl` format `scoring/score.py` reads |
| `tools/serve_local.py` | local test server that also saves answers to disk |

Question photos load from `https://hosamgen.github.io/t1-study-assets/images/`, so that repo must stay public
while the study runs. The site contains no answer key for the real questions.

## Sets and links

Questions are taken in id order. U1 and U3 have 4 sets of 25: **S1 = questions 1–25, S2 = 26–50, S3 = 51–75,
S4 = 76–100**. U2 takes more work per question, so it has **8 sets alternating 12 and 13 questions**: S1 = 1–12,
S2 = 13–25, S3 = 26–37, S4 = 38–50, S5 = 51–62, S6 = 63–75, S7 = 76–87, S8 = 88–100. That makes 16 studies, each with
its own link:

```
?study=U1-S1 … ?study=U1-S4      (4 studies x 25 questions)
?study=U2-S1 … ?study=U2-S8      (8 studies x 12 or 13 questions)
?study=U3-S1 … ?study=U3-S4      (4 studies x 25 questions)
```

The set sizes are `SET_SIZES` in `tools/build_data.py`; change them there and rebuild.

Testing extras (only without a `PROLIFIC_PID`, i.e. preview mode): `&q=0` opens the sample question, `&q=7`
jumps to question 7, `&reset=1` forgets saved progress, and `?part=U2&ids=h294,h053` runs any list of ids.
Preview mode shows a yellow ribbon and sends nothing (unless `save.savePreview` is true). The last page offers a
JSON download of the answers.

## Connecting to Prolific (no Prolific API needed)

For each of the 16 studies:

1. **Study URL**: `https://<host>/?study=U1-S1`, then choose "I'll use URL parameters" so Prolific adds
   `PROLIFIC_PID`, `STUDY_ID`, `SESSION_ID`. The full form is
   `https://<host>/?study=U1-S1&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`.
2. **Completion**: choose "redirect to a URL" and set a custom completion code. Put the same code in
   `config.js → prolific.completionCodes` under `"U1-S1"`. You can also use one code per part (`"U1"`) or one
   `"default"`. Once the answers are saved, the participant sees the code and is sent to
   `https://app.prolific.com/submissions/complete?cc=<code>`.
3. **Devices**: allow desktop only.
4. **Screening**: if each person should do only one set, exclude participants of the other studies.

Progress is kept in the participant's browser, so a reload continues where they were. A finished session shows
the completion page again instead of restarting.

## Saving answers

When the participant finishes, the site sends one JSON file (`config.js → save`). It retries 3 times. If it
still fails, the participant sees their answers as text they can copy into a Prolific message, plus the
completion code.

**Recommended: DataPipe → Google Drive.** DataPipe is free and built for static study sites used with Prolific.
(It no longer creates new experiments on OSF and stops writing to OSF after 16 November 2026; Google Drive,
Dataverse and Zenodo are the current options.) Set it up like this:

1. Sign up at <https://pipe.jspsych.org>.
2. **Account Settings → Storage Providers → Connect** next to Google Drive. Sign in with the Google account that
   should own the data.
3. **New Experiment** → provider Google Drive → a title. Optionally choose a Drive folder; the default is
   My Drive/DataPipe.
4. On the experiment dashboard:
   - copy the **Experiment ID**;
   - turn on **Accept new data**;
   - optionally, under data validation choose JSON and require the fields `responses` and `annotator`.
5. In `config.js` set `save: { method: "datapipe", datapipeExperimentId: "<id>" }` and publish again.

Each participant becomes one file, `U2-S3_<PROLIFIC_PID>_<SESSION_ID>.json`, a few KB each. To score, download the
folder and run `tools/collect.py` on it.

**Alternative: Google Apps Script → Google Drive.** Create this script at <https://script.google.com>:

```js
function doPost(e) {
  const folder = DriveApp.getFolderById("<drive folder id>");
  const d = JSON.parse(e.postData.contents);
  folder.createFile([d.set, d.annotator, Date.now()].join("_") + ".json", e.postData.contents);
  return ContentService.createTextOutput('{"ok":true}').setMimeType(ContentService.MimeType.JSON);
}
```

Deploy it as a web app (execute as *me*, access *anyone*), then set `save: { method: "post", postUrl: "<web app URL>" }`.

## What gets saved

```jsonc
{ "schema": "t1-human-study/v1", "part": "U2", "set": "U2-S1", "batch": "S1", "annotator": "<PROLIFIC_PID>",
  "prolific": { "PROLIFIC_PID": "...", "STUDY_ID": "...", "SESSION_ID": "..." },
  "started_at": "...", "finished_at": "...", "total_seconds": 812.4, "sample_seconds": 48.0,
  "client": { "viewport": [1440, 900], ... }, "question_order": ["h002", ...],
  "responses": [ { "annotator": "...", "id": "h002", "answer": { "1": "A", "2": "C", ... },
                   "seconds": 41.2, "submitted_at": "...", "position": 1, "layout": "stacked", "image_errors": 0 } ] }
```

`answer` uses the scorer's format: U1/U3 = sorted list of box numbers (U1 "None of the boxes" = `[]`); U2 =
`{"<box>": "<letter>"}`. `seconds` counts only time the tab was visible.

## Collecting and scoring

```bash
python tools/collect.py <downloaded files or folder> --out responses    # writes responses/humans_U{1,2,3}.jsonl
# then, in the study kit directory:
python scoring/score.py responses/*.jsonl
```

`collect.py` skips preview runs (`--include-preview` keeps them) and reports duplicates and how many answers each
id got. Note that `score.py` counts ids an annotator did not answer as wrong, so per-annotator rows are low when
each person answers one set only.

## Text shown to participants

- Welcome, consent, end text: `config.js`.
- Instructions page: the `instructions` field in `data/u*.json`. U2 and U3 are copied verbatim from the question
  files. **U1 is a draft** (the U1 file has none); edit `U1_INSTRUCTIONS` in `tools/build_data.py` and rebuild
  with `python tools/build_data.py --src <clone of t1-study-assets>`.
- Questions (panel, top to bottom). All of it is the original question text, only reordered and styled:
  - **About the photos**: the sentences that describe the photos ("Image 1 is the site before the project; …").
  - **Project brief:** the brief. In U1 the goal (its last sentence, after the last ". ") is bold on its own line;
    in U3 the "Objective for this question" is highlighted.
  - The question. U1/U3 end with **Select *all* that apply.** U2 shows its three answer rules as a highlighted
    "How to answer" list.

  "About the photos" and "How to answer" are open on questions 1–5 and collapsed after that, with a click to
  reopen (`collapseAfter`).
- Sample question: `data/examples.json` (`showExample: false` in `config.js` turns it off). Participants must
  tick "Please confirm before continuing: I have read and understood the examples shown in this sample question"
  before the questions start; the time is saved as `sample_confirmed_at`.

## Hosting

Any static HTTPS host works. The site is published with **GitHub Pages** from the public repo `HosamGen/t1-study`, at
`https://hosamgen.github.io/t1-study/?study=U1-S1`: free, no server to keep running, and it handles many
participants at once. A local machine is fine for testing (`python tools/serve_local.py`), but Prolific
participants can't reach it.

After changing `app.js`/`style.css`, bump the `?v=` numbers in `index.html` so returning browsers don't use
cached copies.
