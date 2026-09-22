// One accessible loading indicator shared by route and inline loading states.
export function createLoader(label = "Loading…") {
  const root = document.createElement("div");
  root.className = "app-loader";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  const graphic = document.createElement("div");
  graphic.className = "app-loader__graphic";
  graphic.setAttribute("aria-hidden", "true");
  for (const group of ["tracks", "balls"]) {
    const layer = document.createElement("div");
    layer.className = "app-loader__layer";
    for (let i = 0; i < 9; i++) {
      const rail = document.createElement("span");
      rail.className = `app-loader__rail app-loader__rail--${group}`;
      rail.style.setProperty("--angle", `${i * 20}deg`);
      if (group === "balls") {
        const ball = document.createElement("span");
        ball.className = "app-loader__ball";
        ball.style.animationDelay = `${i * 0.2}s`;
        rail.append(ball);
      }
      layer.append(rail);
    }
    graphic.append(layer);
  }
  const caption = document.createElement("span");
  caption.className = "app-loader__caption";
  caption.textContent = label;
  root.append(graphic, caption);
  return root;
}
