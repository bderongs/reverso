(function () {
  var steps = [
    { file: "01-use-case.html", label: "Use case" },
    { file: "02-download.html", label: "Download" },
    { file: "03-premium.html", label: "Premium" },
    { file: "04-account.html", label: "Account" }
  ];

  var path = window.location.pathname;
  var currentFile = path.split("/").pop() || "01-use-case.html";
  var params = new URLSearchParams(window.location.search);
  var usecase = params.get("usecase");
  var qs = usecase ? "?usecase=" + encodeURIComponent(usecase) : "";

  var banner = document.createElement("aside");
  banner.className = "demo-banner";
  banner.setAttribute("aria-label", "Demo preview switcher");

  var links = steps
    .map(function (step, i) {
      var active = step.file === currentFile ? " is-active" : "";
      var href = step.file === "01-use-case.html" ? step.file : step.file + qs;
      var current = active ? ' aria-current="page"' : "";
      return (
        '<a class="demo-banner__link' +
        active +
        '" href="' +
        href +
        '"' +
        current +
        ">" +
        '<span class="demo-banner__step">' +
        (i + 1) +
        "</span>" +
        step.label +
        "</a>"
      );
    })
    .join("");

  banner.innerHTML =
    '<div class="demo-banner__inner">' +
    '<span class="demo-banner__label">Demo preview</span>' +
    '<nav class="demo-banner__nav" aria-label="Jump to onboarding step">' +
    links +
    "</nav>" +
    '<span class="demo-banner__note">Mockup only — not production UI</span>' +
    "</div>";

  document.body.insertBefore(banner, document.body.firstChild);
})();
