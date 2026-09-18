var term = (output.currentTerm || maestro.copiedText || "").trim();
var example = (output.currentExample || "").trim();
var runId = output.quizRunId || new Date().toISOString();
var turn = Number(output.turn) || 1;
var loggerUrl =
  typeof TERM_LOGGER_URL !== "undefined" && TERM_LOGGER_URL
    ? TERM_LOGGER_URL
    : "http://127.0.0.1:18765/terms";

var terms = [];
try {
  terms = JSON.parse(output.presentedTermsJson || "[]");
} catch (error) {
  terms = [];
}

var last = terms.length ? terms[terms.length - 1] : null;
if (term && last && last.term === term && Number(last.turn) === turn) {
  console.log("QUIZ_TERM_SKIP_DUPLICATE turn=" + turn + " " + term);
} else if (term) {
  var entry = {
    runId: runId,
    turn: turn,
    index: terms.length + 1,
    term: term,
    example: example,
    capturedAt: new Date().toISOString(),
  };
  terms.push(entry);
  output.presentedTermsJson = JSON.stringify(terms);
  output.lastRecordedTerm = term;

  try {
    var response = http.post(loggerUrl, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    output.lastRecordStatus = String(response.status);
    console.log("QUIZ_TERM turn=" + turn + " " + term + " status=" + response.status);
  } catch (error) {
    output.lastRecordStatus = String(error);
    console.log("QUIZ_TERM_ERROR " + term + " " + error);
  }
} else {
  console.log("QUIZ_TERM_EMPTY");
}

output.presentedTermsJson = JSON.stringify(terms);
