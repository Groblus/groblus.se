document.querySelectorAll("img").forEach((item) => {
  item.addEventListener("click", () => {
    const dialog = document.createElement("dialog");
    const img = document.createElement("img");
    img.src = item.src;
    img.style.maxWidth = "90vw";
    img.style.maxHeight = "90vh";
    dialog.appendChild(img);
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => document.body.removeChild(dialog));
  });
});
