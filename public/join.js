const socket = io();

const form = document.getElementById("joinForm");
const input = document.getElementById("wordInput");
const button = document.getElementById("submitBtn");
const feedback = document.getElementById("feedback");
const suggestions = document.getElementById("suggestions");
const joinTotal = document.getElementById("joinTotal");
const joinUnique = document.getElementById("joinUnique");
const joinTop = document.getElementById("joinTop");

const suggestionWords = [
  "libertate",
  "pace",
  "Erasmus",
  "solidaritate",
  "Schengen",
  "viitor",
  "drepturi",
  "diversitate"
];

suggestions.replaceChildren(...suggestionWords.map((word) => {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.textContent = word;
  chip.addEventListener("click", () => {
    input.value = word;
    input.focus();
  });
  return chip;
}));

socket.on("connect", () => {
  setFeedback("Conectat. Poți trimite răspunsul.", "ok");
  button.disabled = false;
});

socket.on("disconnect", () => {
  setFeedback("Reconectare la sesiune...", "error");
  button.disabled = true;
});

socket.on("snapshot", (snapshot) => {
  joinTotal.textContent = snapshot.total;
  joinUnique.textContent = snapshot.unique;
  joinTop.textContent = snapshot.counts[0]?.word || "-";
  button.disabled = snapshot.locked || !socket.connected;
  input.disabled = snapshot.locked;
  if (snapshot.locked) setFeedback("Colectarea este pauzată de profesor.", "error");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    setFeedback("Scrie un cuvânt înainte să trimiți.", "error");
    input.focus();
    return;
  }

  button.disabled = true;
  socket.emit("submit-word", { text }, (response) => {
    button.disabled = false;
    if (!response?.ok) {
      setFeedback(response?.message || "Nu am putut trimite răspunsul.", "error");
      input.focus();
      return;
    }

    input.value = "";
    setFeedback(response.message || "Răspuns trimis.", "ok");
    input.focus();
  });
});

input.addEventListener("input", () => {
  const remaining = 36 - [...input.value].length;
  if (remaining < 0) input.value = [...input.value].slice(0, 36).join("");
});

function setFeedback(message, type) {
  feedback.textContent = message;
  feedback.classList.toggle("ok", type === "ok");
  feedback.classList.toggle("error", type === "error");
}
