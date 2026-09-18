var raw = "";
if (typeof TURNS !== "undefined" && String(TURNS).trim() !== "") {
  raw = String(TURNS);
} else if (typeof TURN !== "undefined" && String(TURN).trim() !== "") {
  raw = String(TURN);
} else if (typeof turn !== "undefined" && String(turn).trim() !== "") {
  raw = String(turn);
} else {
  raw = "1";
}

output.turns = Math.max(1, parseInt(raw, 10) || 1);
output.turn = 1;
console.log("QUIZ_TURNS=" + output.turns);
