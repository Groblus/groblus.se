"use strict";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const state = {
  user: null,
  games: [],
  plans: [],
  slots: [],
  availabilityDirty: false,
  plansLoaded: false,
  availabilityLoaded: false,
  plansError: false,
  availabilityError: false,
};
const days = [
  "Måndag",
  "Tisdag",
  "Onsdag",
  "Torsdag",
  "Fredag",
  "Lördag",
  "Söndag",
];
const periods = {
  day: "Dagtid 10–14",
  afternoon: "Eftermiddag 14–18",
  evening: "Kväll 18–22",
};
const preferences = {
  unset: "○ Ej angivet",
  often: "● Ofta",
  sometimes: "◐ Ibland",
  rarely: "– Sällan",
};
const kinds = { rpg: "ROLLSPEL", boardgame: "BRÄDSPEL", other: "ANNAT" };
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let toastTimer;
function notify(message) {
  $("#global-message").textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#global-message").textContent = "";
  }, 6000);
}
async function api(path, method = "GET", body) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    redirect: "manual",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // Access owns authentication. Re-enter through a top-level navigation only.
  const accessExpired = response.status === 401 || response.type === "opaqueredirect" || response.headers.get("content-type")?.includes("text/html");
  if (accessExpired) {
    showSignedOut();
    $("#access-login").textContent = "Logga in igen";
    $("#auth-message").textContent = "Din session har gått ut. Logga in igen för att fortsätta.";
    const error = new Error("Din session har gått ut. Logga in igen.");
    error.status = 401;
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Servern svarade inte som väntat. Försök igen.");
  }
  if (!response.ok) {
    const error = new Error(data.error || "Det gick inte att spara. Försök igen.");
    error.status = response.status;
    throw error;
  }
  return data;
}
// HTML dialogs work consistently in browsers and keep focus within the choice.
function confirmAction(title, message, confirmLabel) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirmation-dialog";
    dialog.setAttribute("aria-labelledby", "confirmation-title");
    dialog.setAttribute("aria-describedby", "confirmation-message");
    const heading = document.createElement("h2");
    heading.id = "confirmation-title";
    heading.textContent = title;
    const description = document.createElement("p");
    description.id = "confirmation-message";
    description.textContent = message;
    const actions = document.createElement("div");
    actions.className = "confirmation-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Avbryt";
    cancel.autofocus = true;
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "primary";
    accept.textContent = confirmLabel;
    actions.append(cancel, accept);
    dialog.append(heading, description, actions);
    document.body.append(dialog);
    cancel.addEventListener("click", () => dialog.close("cancel"));
    accept.addEventListener("click", () => dialog.close("confirm"));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.close("cancel");
    });
    dialog.addEventListener(
      "close",
      () => {
        const accepted = dialog.returnValue === "confirm";
        dialog.remove();
        resolve(accepted);
      },
      { once: true },
    );
    dialog.showModal();
  });
}
async function busy(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}
function showSignedOut() {
  state.user = null;
  state.games = [];
  state.plans = [];
  state.slots = [];
  state.availabilityDirty = false;
  state.plansLoaded = false;
  state.availabilityLoaded = false;
  state.plansError = false;
  state.availabilityError = false;
  renderNoticeboard();
  $("#member-view").classList.add("hidden");
  $("#auth-view").classList.remove("hidden");
  $("#profile-open").classList.add("hidden");
  $$("dialog[open]").forEach((d) => d.close());
}
async function enter(user) {
  state.user = user;
  $("#auth-view").classList.add("hidden");
  $("#member-view").classList.remove("hidden");
  $("#profile-open").classList.remove("hidden");
  $("#greeting").textContent =
    user.displayName
      ? `Hej ${user.displayName}! Välj spel och hitta andra som vill vara med.`
      : "Välkommen! Välj spel och hitta andra som vill vara med.";
  $("#profile-name").value = user.displayName;
  $("#profile-form .form-message").textContent = user.needsDisplayName
    ? "Välkommen! Vad vill du heta på spelhyllan?"
    : "";
  $("#profile-email").textContent = user.email || "";
  $("#link-discord").classList.toggle("hidden", user.discordLinked);
  $("#discord-code").textContent = user.discordLinked
    ? "Ditt konto är kopplat till Discord."
    : "";
  try {
    await Promise.all([loadGames(), loadAvailability(), loadPlans()]);
    if (state.user && user.needsDisplayName) {
      $("#profile-dialog").showModal();
      $("#profile-name").focus();
    }
  } catch (error) {
    notify(error.message);
  }
}
async function loadGames() {
  const result = await api("/games");
  state.games = result.games;
  renderGames();
}
function renderGames() {
  const search = $("#game-search").value.trim().toLocaleLowerCase("sv");
  const kind = $("#game-kind").value;
  const mine = $("#my-games").checked;
  const games = state.games.filter(
    (g) =>
      g.name.toLocaleLowerCase("sv").includes(search) &&
      (kind === "all" || g.kind === kind) &&
      (!mine || g.wantPlay || g.wantGm),
  );
  $("#game-total").textContent = state.games.length;
  $("#games-grid").innerHTML = games.length
    ? games
        .map(
          (g) =>
            `<article class="game-card"><div class="game-identity"><div class="game-art ${escapeHtml(g.kind)}" aria-hidden="true"><span class="glyph">${g.kind === "rpg" ? "✧" : g.kind === "boardgame" ? "♜" : "⚄"}</span></div><div class="game-title"><h3>${escapeHtml(g.name)}</h3><p class="game-kind">${kinds[g.kind] || "SPEL"}</p></div></div><div class="game-people"><p class="counts"><span>${g.playCount} vill spela</span><span>${g.gmCount} vill spelleda</span></p><button class="quiet players-button" data-players="${escapeHtml(g.id)}" aria-label="Se intresserade för ${escapeHtml(g.name)}">Se intresserade →</button></div><div class="interest-buttons"><button data-interest="play" data-game="${escapeHtml(g.id)}" aria-pressed="${!!g.wantPlay}" aria-label="Vill spela ${escapeHtml(g.name)}">${g.wantPlay ? "✓" : "+"} Vill spela</button><button data-interest="gm" data-game="${escapeHtml(g.id)}" aria-pressed="${!!g.wantGm}" aria-label="Vill spelleda ${escapeHtml(g.name)}">${g.wantGm ? "✓" : "+"} Vill spelleda</button></div></article>`,
        )
        .join("")
    : `<div class="empty"><h3>${state.games.length ? "Ingen träff på hyllan." : "Hylla söker spel."}</h3><p>${state.games.length ? "Prova ett annat sökord eller ändra filtren." : "Lägg till det första spelet, så kan fler hitta det."}</p></div>`;
  $("#plan-game").innerHTML = state.games
    .map(
      (g) =>
        `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`,
    )
    .join("");
}
$("#games-grid").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.players) {
    busy(button, () => openPlayers(button.dataset.players));
    return;
  }
  if (!button.dataset.interest) return;
  busy(button, async () => {
    const siblings = $$("button", button.closest(".interest-buttons"));
    siblings.forEach((b) => (b.disabled = true));
    try {
      const game = state.games.find((g) => g.id === button.dataset.game);
      const next = { wantPlay: !!game.wantPlay, wantGm: !!game.wantGm };
      next[button.dataset.interest === "play" ? "wantPlay" : "wantGm"] =
        !next[button.dataset.interest === "play" ? "wantPlay" : "wantGm"];
      await api(`/interests/${encodeURIComponent(game.id)}`, "PUT", next);
      await loadGames();
      const replacement = $$("[data-interest]").find(
        (item) =>
          item.dataset.game === button.dataset.game &&
          item.dataset.interest === button.dataset.interest,
      );
      (replacement || $("#my-games")).focus();
      notify("Ditt intresse är sparat.");
    } finally {
      siblings.forEach((b) => (b.disabled = false));
    }
  });
});
["game-search", "game-kind", "my-games"].forEach((id) =>
  $("#" + id).addEventListener("input", renderGames),
);
function selectTab(tab, focusHeading = false) {
  const button = $$("[data-tab]").find((item) => item.dataset.tab === tab);
  if (!button) return;
  $$("[data-tab]").forEach((item) => item.removeAttribute("aria-current"));
  button.setAttribute("aria-current", "page");
  $$(".panel").forEach((panel) => panel.classList.add("hidden"));
  const panel = $("#" + tab + "-panel");
  panel.classList.remove("hidden");
  if (focusHeading) {
    const heading = $("h2", panel);
    heading.tabIndex = -1;
    heading.focus();
  }
}
$$("[data-tab]").forEach((button) =>
  button.addEventListener("click", () => selectTab(button.dataset.tab)),
);
$("#member-view").addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-tab]");
  if (button) {
    selectTab(button.dataset.openTab, true);
    if (button.dataset.openPlan) {
      const card = $$("[data-plan-card]").find(
        (item) => item.dataset.planCard === button.dataset.openPlan,
      );
      if (card) {
        card.tabIndex = -1;
        card.focus();
      }
    }
  }
  const retry = event.target.closest("[data-retry-summary]");
  if (retry)
    busy(retry, () =>
      retry.dataset.retrySummary === "plans" ? loadPlans() : loadAvailability(),
    );
});
$$("[data-close]").forEach((button) =>
  button.addEventListener("click", () => button.closest("dialog").close()),
);
$("#add-game-open").addEventListener("click", () => {
  $("#game-form").reset();
  $("#game-form .form-message").textContent = "";
  $("#game-dialog").showModal();
});
$("#game-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy($("button[type=submit]", event.target), async () => {
    try {
      await api(
        "/games",
        "POST",
        Object.fromEntries(new FormData(event.target)),
      );
      await loadGames();
      $("#game-dialog").close();
      notify("Spelet finns nu på hyllan.");
    } catch (error) {
      $(".form-message", event.target).textContent = error.message;
    }
  });
});
async function loadAvailability() {
  let result;
  try {
    result = await api("/availability");
    state.availabilityError = false;
  } catch (error) {
    state.availabilityError = true;
    renderNoticeboard();
    throw error;
  }
  state.slots = result.slots;
  state.availabilityLoaded = true;
  state.availabilityDirty = false;
  renderAvailability();
}
function renderAvailability() {
  renderNoticeboard();
  $("#availability-body").innerHTML = days
    .map(
      (day, index) =>
        `<tr><th scope="row">${day}</th>${Object.keys(periods)
          .map((period) => {
            const value =
              state.slots.find((s) => s.day === index && s.period === period)
                ?.preference || "unset";
            return `<td><button class="slot" data-day="${index}" data-period="${period}" data-value="${value}" aria-label="${day} ${periods[period]}: ${preferences[value]}. Klicka för nästa svar.">${preferences[value]}</button></td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
}
$("#availability-body").addEventListener("click", (event) => {
  const button = event.target.closest(".slot");
  if (!button) return;
  const day = Number(button.dataset.day),
    period = button.dataset.period;
  const values = Object.keys(preferences),
    next = values[(values.indexOf(button.dataset.value) + 1) % values.length];
  state.slots = state.slots.filter(
    (s) => !(s.day === day && s.period === period),
  );
  if (next !== "unset") state.slots.push({ day, period, preference: next });
  state.availabilityDirty = true;
  renderAvailability();
  $(`[data-day="${day}"][data-period="${period}"]`).focus();
  $("#availability-status").textContent =
    "Du har ändringar som inte är sparade. Klicka på Spara mina tider.";
});
$("#save-availability").addEventListener("click", (event) =>
  busy(event.currentTarget, async () => {
    const snapshot = JSON.stringify(state.slots);
    await api("/availability", "PUT", { slots: JSON.parse(snapshot) });
    state.availabilityDirty = JSON.stringify(state.slots) !== snapshot;
    $("#availability-status").textContent = state.availabilityDirty
      ? "Nya ändringar är inte sparade än."
      : "Sparat! Alla tider är lokal tid i Sverige.";
    renderNoticeboard();
    notify("Dina tider är sparade.");
  }),
);
window.addEventListener("beforeunload", (event) => {
  if (state.availabilityDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
$("#profile-open").addEventListener("click", () =>
  $("#profile-dialog").showModal(),
);
$("#logout").addEventListener("click", (event) =>
  busy(event.currentTarget, async () => {
    if (
      state.availabilityDirty &&
      !(await confirmAction(
        "Logga ut?",
        "Du har osparade tider. Om du loggar ut försvinner ändringarna.",
        "Logga ut",
      ))
    )
      return;
    state.availabilityDirty = false;
    window.location.assign("/cdn-cgi/access/logout");
  }),
);
$("#link-discord").addEventListener("click", (event) =>
  busy(event.currentTarget, async () => {
    const result = await api("/discord/link-code", "POST", {});
    $("#discord-code").innerHTML =
      `Din engångskod:<code>${escapeHtml(result.code)}</code>Skriv <strong>/groblus koppla</strong> i Discord och ange koden. Gäller till ${escapeHtml(new Date(result.expiresAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }))}. Dela inte koden med någon annan.`;
  }),
);
function formatOption(option) {
  const start = new Date(option.startsAt),
    end = new Date(option.endsAt);
  const date = start.toLocaleDateString("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Stockholm",
  });
  const timeOptions = {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  };
  const endDate = end.toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Stockholm",
  });
  const sameDay =
    start.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }) ===
    end.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  return `${date} · ${start.toLocaleTimeString("sv-SE", timeOptions)}–${sameDay ? "" : endDate + " "}${end.toLocaleTimeString("sv-SE", timeOptions)}`;
}
function renderNoticeboard() {
  $("#plan-total").textContent = state.plansLoaded ? state.plans.length : "";
  const upcoming = state.plans
    .flatMap((plan) => {
      const options = plan.options
        .filter(
          (option) =>
            new Date(option.endsAt).getTime() > Date.now() &&
            (plan.status !== "confirmed" ||
              option.id === plan.confirmedOptionId),
        )
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
      return options.length ? [{ plan, options }] : [];
    })
    .sort(
      (a, b) =>
        new Date(a.options[0].startsAt) - new Date(b.options[0].startsAt),
    );
  const next = upcoming[0];
  if (state.plansError) {
    $("#next-plan").innerHTML =
      '<p class="notice-label">TRÄFFAR</p><h2 class="notice-heading">Kunde inte hämta träffar</h2><button class="secondary" data-retry-summary="plans">Försök igen</button>';
  } else if (!state.plansLoaded) {
    $("#next-plan").innerHTML =
      '<p class="notice-label">TRÄFFAR</p><h2 class="notice-heading">Hämtar träffar…</h2>';
  } else if (next) {
    const confirmed = next.plan.status === "confirmed";
    $("#next-plan").innerHTML =
      `<p class="notice-label">${confirmed ? "NÄSTA TRÄFF · DATUM SPIKAT" : "DATUMFÖRSLAG"}</p><h2 class="notice-heading">${escapeHtml(next.plan.title)}</h2><p class="notice-game">${escapeHtml(next.plan.gameName)}</p><p class="notice-copy">${escapeHtml(formatOption(next.options[0]))}</p>${!confirmed && next.options.length > 1 ? `<p class="notice-footnote">Och ${next.options.length - 1} andra kommande datumförslag.</p>` : ""}<button class="primary full" data-open-tab="plans" data-open-plan="${escapeHtml(next.plan.id)}">${confirmed ? "Visa träffen" : "Svara på datum"} →</button>`;
  } else {
    $("#next-plan").innerHTML =
      '<p class="notice-label">TRÄFFAR</p><h2 class="notice-heading">Ingen kommande träff än</h2><p class="notice-copy">Lägg upp en spelidé med ett par datum, så kan fler svara.</p><button class="primary full" data-open-tab="plans">Planera en träff →</button>';
  }
  const positive = state.slots
    .filter(
      (slot) => slot.preference === "often" || slot.preference === "sometimes",
    )
    .sort(
      (a, b) =>
        (a.preference === "often" ? 0 : 1) -
          (b.preference === "often" ? 0 : 1) ||
        a.day - b.day ||
        Object.keys(periods).indexOf(a.period) -
          Object.keys(periods).indexOf(b.period),
    );
  $("#times-summary").innerHTML = state.availabilityError
    ? '<p class="notice-copy">Kunde inte hämta dina tider.</p><button class="secondary" data-retry-summary="availability">Försök igen</button>'
    : !state.availabilityLoaded
      ? '<p class="notice-copy">Hämtar dina tider…</p>'
      : `${
          positive.length
            ? `<ul class="notice-times">${positive
                .slice(0, 3)
                .map(
                  (slot) =>
                    `<li><strong>${days[slot.day]}</strong><span>${periods[slot.period]}<small>${slot.preference === "often" ? "Ofta" : "Ibland"}</small></span></li>`,
                )
                .join(
                  "",
                )}</ul>${positive.length > 3 ? `<p class="notice-footnote">Och ${positive.length - 3} andra tider. Se alla under Mina tider.</p>` : ""}`
            : `<p class="notice-copy">${state.slots.length ? "Du har inte angett någon tid som ofta eller ibland passar." : "När brukar du kunna spela? Fyll i din vanliga vecka."}</p>`
        }${state.availabilityDirty ? '<p class="notice-unsaved">Ändringarna är inte sparade än.</p>' : ""}`;
}
async function loadPlans() {
  try {
    state.plans = (await api("/plans")).plans;
    state.plansError = false;
  } catch (error) {
    state.plansError = true;
    renderNoticeboard();
    throw error;
  }
  state.plansLoaded = true;
  renderPlans();
}
function renderPlans() {
  renderNoticeboard();
  $("#plans-list").innerHTML = state.plans.length
    ? state.plans
        .map(
          (plan) =>
            `<article class="plan-card" data-plan-card="${escapeHtml(plan.id)}"><div class="plan-title-row"><div><p class="eyebrow">${escapeHtml(plan.gameName)}</p><h3>${escapeHtml(plan.title)}</h3></div><span class="badge">${plan.status === "confirmed" ? "DATUM SPIKAT" : "DATUMFÖRSLAG"}</span></div>${plan.description ? `<p class="plan-description">${escapeHtml(plan.description)}</p>` : ""}${plan.options
              .map(
                (option) =>
                  `<div class="plan-option ${plan.confirmedOptionId === option.id ? "confirmed-option" : ""}"><div><time datetime="${escapeHtml(option.startsAt)}">${escapeHtml(formatOption(option))}</time><span class="vote-counts">${option.yesCount} kan · ${option.maybeCount} kanske · ${option.noCount} kan inte</span>${plan.confirmedOptionId === option.id ? '<div class="confirmed-label">✓ Träffens datum</div>' : ""}</div><div class="vote-actions">${[
                    ["yes", "Kan"],
                    ["maybe", "Kanske"],
                    ["no", "Kan inte"],
                  ]
                    .map(
                      ([vote, label]) =>
                        `<button data-vote="${vote}" data-plan="${escapeHtml(plan.id)}" data-option="${escapeHtml(option.id)}" aria-pressed="${option.myVote === vote}" aria-label="${label}: ${escapeHtml(formatOption(option))}">${label}</button>`,
                    )
                    .join(
                      "",
                    )}${plan.creatorId === state.user.id && plan.status !== "confirmed" ? `<button class="confirm-date" data-confirm="${escapeHtml(option.id)}" data-plan="${escapeHtml(plan.id)}">Spika datum</button>` : ""}</div></div>`,
              )
              .join("")}</article>`,
        )
        .join("")
    : '<div class="empty"><h3>Nästa spelkväll börjar här.</h3><p>Föreslå en träff med ett par datum och låt de andra svara.</p></div>';
}
$("#plans-list").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  busy(button, async () => {
    const optionButtons = $$("button", button.closest(".plan-option"));
    optionButtons.forEach((item) => {
      item.disabled = true;
    });
    try {
      if (button.dataset.confirm) {
        if (
          !(await confirmAction(
            "Spika datumet?",
            "Datumet bekräftas för träffen. Det räknas inte som en anmälan.",
            "Spika datum",
          ))
        )
          return;
        await api(
          `/plans/${encodeURIComponent(button.dataset.plan)}/confirm`,
          "POST",
          { optionId: button.dataset.confirm },
        );
      } else {
        await api(
          `/plans/${encodeURIComponent(button.dataset.plan)}/votes/${encodeURIComponent(button.dataset.option)}`,
          "PUT",
          {
            vote:
              button.getAttribute("aria-pressed") === "true"
                ? null
                : button.dataset.vote,
          },
        );
      }
      await loadPlans();
      const replacement = $$("[data-vote]").find(
        (item) =>
          item.dataset.plan === button.dataset.plan &&
          item.dataset.option ===
            (button.dataset.option || button.dataset.confirm) &&
          item.dataset.vote === (button.dataset.vote || "yes"),
      );
      replacement?.focus();
      notify(
        button.dataset.confirm ? "Datumet är spikat." : "Ditt svar är sparat.",
      );
    } finally {
      optionButtons.forEach((item) => {
        item.disabled = false;
      });
    }
  });
});
let dateSequence = 0;
function addDate() {
  const count = $$(".date-row").length;
  if (count >= 5) return;
  const id = ++dateSequence;
  const row = document.createElement("div");
  row.className = "date-row";
  row.innerHTML = `<div class="date-row-head"><strong>Datumförslag</strong><button type="button" class="quiet remove-date">Ta bort</button></div><div class="date-fields"><label for="start-${id}">Från<input id="start-${id}" type="datetime-local" name="start" required></label><label for="end-${id}">Till<input id="end-${id}" type="datetime-local" name="end" required></label></div>`;
  $("#plan-dates").append(row);
  updateDates();
}
function updateDates() {
  $$(".date-row").forEach((row, i) => {
    $("strong", row).textContent = `Alternativ ${i + 1}`;
    $(".remove-date", row).disabled = $$(".date-row").length <= 2;
  });
  $("#add-date").disabled = $$(".date-row").length >= 5;
}
$("#plan-dates").addEventListener("click", (event) => {
  if (event.target.matches(".remove-date") && $$(".date-row").length > 2) {
    event.target.closest(".date-row").remove();
    updateDates();
  }
});
$("#add-date").addEventListener("click", addDate);
$("#add-plan-open").addEventListener("click", () => {
  if (!state.games.length) {
    notify("Lägg till ett spel på hyllan först.");
    return;
  }
  $("#plan-form").reset();
  $("#plan-form .form-message").textContent = "";
  $("#plan-dates").innerHTML = "";
  addDate();
  addDate();
  $("#plan-dialog").showModal();
});
// Interpret date inputs in Europe/Stockholm, independently of the device timezone.
function stockholmISO(value) {
  const target = new Date(value + "Z");
  if (!Number.isFinite(target.getTime()))
    throw new Error("Ange giltiga datum och tider.");
  let timestamp = target.getTime();
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Stockholm",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(timestamp))
        .map((p) => [p.type, p.value]),
    );
    const local = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
    timestamp += target.getTime() - local;
  }
  const check = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(timestamp))
    .replace(" ", "T");
  if (check !== value)
    throw new Error(
      "En av tiderna finns inte på grund av sommartidsomställning. Välj en annan tid.",
    );
  return new Date(timestamp).toISOString();
}
$("#plan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy($("button[type=submit]", event.target), async () => {
    try {
      const data = Object.fromEntries(new FormData(event.target));
      const options = $$(".date-row").map((row) => ({
        startsAt: stockholmISO($("[name=start]", row).value),
        endsAt: stockholmISO($("[name=end]", row).value),
      }));
      if (options.some((o) => new Date(o.endsAt) <= new Date(o.startsAt)))
        throw new Error(
          "Sluttiden måste vara efter starttiden för varje alternativ.",
        );
      await api("/plans", "POST", {
        title: data.title,
        gameId: data.gameId,
        description: data.description,
        options,
      });
      await loadPlans();
      $("#plan-dialog").close();
      notify("Träffen är upplagd. Nu kan andra svara.");
    } catch (error) {
      $(".form-message", event.target).textContent = error.message;
    }
  });
});
async function openPlayers(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  let dialog = $("#players-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "players-dialog";
    dialog.setAttribute("aria-labelledby", "players-title");
    document.body.append(dialog);
  }
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="players-title">${escapeHtml(game.name)}</h2><button class="close" aria-label="Stäng">×</button></div><p>Laddar intresserade…</p>`;
  $(".close", dialog).addEventListener("click", () => dialog.close());
  dialog.showModal();
  try {
    const [people, availability] = await Promise.all([
      api(`/games/${encodeURIComponent(gameId)}/players`),
      api(`/games/${encodeURIComponent(gameId)}/availability`),
    ]);
    const best = availability.slots
      .filter((s) => s.oftenCount + s.sometimesCount > 0)
      .sort(
        (a, b) =>
          b.oftenCount - a.oftenCount || b.sometimesCount - a.sometimesCount,
      )
      .slice(0, 3);
    const content = document.createElement("div");
    content.innerHTML = `<h3>Vill vara med</h3>${people.players.length ? `<ul class="players-list">${people.players.map((p) => `<li><strong>${escapeHtml(p.displayName)}</strong><span>${[p.wantPlay ? "Vill spela" : "", p.wantGm ? "Vill spelleda" : ""].filter(Boolean).join(" · ")}</span></li>`).join("")}</ul>` : '<p class="subtle">Ingen har angett intresse ännu. Du kan bli den första.</p>'}<hr><h3>Tider att börja med</h3><p class="subtle">Bland ${availability.interestedCount} intresserade. Vanliga tider, inte svar på en bestämd träff.</p>${best.length ? best.map((s) => `<p class="overlap"><strong>${days[s.day]} · ${periods[s.period]}</strong><span>${s.oftenCount} ofta · ${s.sometimesCount} ibland · ${s.rarelyCount} sällan · ${s.unsetCount} ej angivet</span></p>`).join("") : '<p class="subtle">Inga tider med svaret ofta eller ibland än. Be de intresserade fylla i sina tider.</p>'}`;
    $("p", dialog).replaceWith(content);
  } catch (error) {
    $("p", dialog).textContent = error.message;
  }
}
(async () => {
  try {
    const result = await api("/me");
    await enter(result.user);
  } catch (error) {
    showSignedOut();
    if (error.status !== 401) $("#auth-message").textContent = error.message;
  }
})();

$("#profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  busy($("button[type=submit]", form), async () => {
    try {
      const result = await api("/me", "PUT", { displayName: form.elements.displayName.value.trim() });
      state.user = result.user;
      $("#profile-name").value = result.user.displayName;
      $("#greeting").textContent = `Hej ${result.user.displayName}! Välj spel och hitta andra som vill vara med.`;
      $(".form-message", form).textContent = "Ditt namn är sparat.";
    } catch (error) {
      $(".form-message", form).textContent = error.message;
    }
  });
});
